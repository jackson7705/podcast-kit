#!/usr/bin/env python3
"""Refresh private NotebookLM state and gate the daily publisher."""
import fcntl
import hashlib
import json
import os
import signal
from pathlib import Path
import subprocess
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else {}


def day_key(now):
    return now.astimezone(ZoneInfo('America/Chicago')).date().isoformat()


def unresolved_publication(health):
    return any(value in ('started', 'failed')
               for ledger in ('weeklyAttempts', 'dailyAttempts')
               for value in health.get(ledger, {}).values())


def publication_due(now, health):
    local = now.astimezone(ZoneInfo('America/Chicago'))
    return (local.hour >= 9 and not unresolved_publication(health)
            and day_key(now) not in health.get('dailyAttempts', {}))


def prepare_auth(directory, env):
    """Seed the NotebookLM profile from secrets; preserve cookie rotations on later starts.

    Two credentials are accepted, either or both:

    * ``NOTEBOOKLM_MASTER_TOKEN_JSON`` — the durable Google master token written by
      ``notebooklm login --master-token``. It does not rotate or expire, and the CLI
      re-mints web cookies from it in-process whenever the session dies (layer-4
      recovery), so a profile that holds it never needs a human re-login. This is
      the credential to ship for a scheduled job like this one.
    * ``NOTEBOOKLM_AUTH_JSON`` — a cookie snapshot (``storage_state.json``). Legacy:
      it is superseded by any other client of the same Google session within
      minutes and dies outright every one to two weeks, which is what kept taking
      this automation down. Still honoured as a bootstrap; with a master token on
      disk it is merely a head start.

    Each secret is imported once per revision so cookie rotations the CLI writes
    on later runs are not clobbered by re-importing a stale snapshot.
    """
    profile = directory / 'notebooklm/profiles/default'
    storage = profile / 'storage_state.json'
    master = profile / 'master_token.json'
    revision_file = directory / 'bootstrap.json'
    bootstrap = env.pop('NOTEBOOKLM_AUTH_JSON', None)
    master_token = env.pop('NOTEBOOKLM_MASTER_TOKEN_JSON', None)
    env['NOTEBOOKLM_HOME'] = str(directory / 'notebooklm')
    env['NOTEBOOKLM_PROFILE'] = 'default'
    revisions = read_json(revision_file)
    if master_token:
        revision = hashlib.sha256(master_token.encode()).hexdigest()
        if not master.exists() or revisions.get('masterRevision') != revision:
            value = json.loads(master_token)
            if not isinstance(value, dict) or not value:
                raise ValueError('Invalid master token')
            write_json(master, value)
            revisions['masterRevision'] = revision
            # A new master token means a new account or a re-issued credential:
            # drop cookies minted from the old one so the CLI re-mints cleanly.
            if storage.exists():
                storage.unlink()
            write_json(revision_file, revisions)
    if bootstrap:
        revision = hashlib.sha256(bootstrap.encode()).hexdigest()
        if not storage.exists() or revisions.get('revision') != revision:
            value = json.loads(bootstrap)
            if not isinstance(value, dict) or not value.get('cookies'):
                raise ValueError('Invalid bootstrap')
            write_json(storage, value)
            revisions['revision'] = revision
            write_json(revision_file, revisions)
    if not storage.exists() and not master.exists():
        raise ValueError('Missing bootstrap')
    # With only master_token.json on disk, the `notebooklm auth refresh --verify`
    # step that follows mints the first storage_state.json from it.
    return env


def execute(args, env, timeout):
    # Do not print captured subprocess output: auth diagnostics can contain secrets.
    with subprocess.Popen(args, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, start_new_session=True) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise RuntimeError('Subprocess group timed out') from None
        return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def maintain(directory, now, env, run=execute):
    health_path = directory / 'health.json'
    health = {'checkedAt': now.isoformat()}
    stage = 'health-storage'
    try:
        try:
            health.update(read_json(health_path))
        except Exception:
            health['dailyAttempts'] = {day_key(now): 'failed'}
            raise
        health['checkedAt'] = now.isoformat()
        stage = 'bootstrap'
        child_env = prepare_auth(directory, dict(env))
        stage = 'authentication'
        result = run(['notebooklm', 'auth', 'refresh', '--verify', '--json'], child_env, 120)
        if result.returncode:
            raise RuntimeError('Authentication refresh failed')
        # Separate passive check also protects against a CLI regression in --verify.
        probe = run(['notebooklm', 'auth', 'check', '--test', '--passive', '--json'], child_env, 60)
        auth = json.loads(probe.stdout)
        if probe.returncode or auth.get('status') != 'ok' or not auth.get('checks', {}).get('token_fetch'):
            raise RuntimeError('Authentication probe failed')
        health['authVerifiedAt'] = now.isoformat()
        if publication_due(now, health):
            stage = 'publication-history'
            history = run(['python3', 'automation/r2_state.py', 'get'], child_env, 60)
            if history.returncode:
                raise RuntimeError('Cannot verify publication history')
            runs = json.loads(history.stdout).get('runs', [])
            completed = any(r.get('result') in ('published', 'no-new-article')
                            and day_key(datetime.fromisoformat(r['at'].replace('Z', '+00:00'))) == day_key(now)
                            for r in runs)
            attempts = health.setdefault('dailyAttempts', {})
            attempts[day_key(now)] = 'already-completed' if completed else 'started'
            health['dailyAttempts'] = dict(sorted(attempts.items())[-12:])
            # Reserve before any publication: crashes must not cause duplicate reruns.
            write_json(health_path, health)
            if not completed:
                stage = 'publication'
                result = run(['node', 'automation/weekly.mjs', '--force-schedule'], child_env, 3600)
                log_path = directory / 'last-publication.log'
                log_path.write_text(result.stdout + result.stderr)
                log_path.chmod(0o600)
                if result.returncode:
                    health['dailyAttempts'][day_key(now)] = 'failed'
                    raise RuntimeError('Publication failed; inspect before retrying')
                health['dailyAttempts'][day_key(now)] = 'completed'
        if unresolved_publication(health):
            stage = 'publication'
            raise RuntimeError('Previous publication requires inspection')
        health['status'] = 'ok'
        health.pop('failureStage', None)
        write_json(health_path, health)
        print(json.dumps({'status': 'ok', 'checkedAt': health['checkedAt'],
                          'day': day_key(now),
                          'publication': health.get('dailyAttempts', {}).get(day_key(now))}))
        return 0
    except Exception:
        # Store fixed stage names, never exceptions, command output or credentials.
        health.update(status='failed', failureStage=stage)
        health['failures'] = (health.get('failures', []) + [
            {'at': now.isoformat(), 'stage': stage}])[-50:]
        write_json(health_path, health)
        if env.get('AUTOMATION_EMAIL_ALERTS') == '1':
            # Reserve before sending, including ambiguous timeouts. Never auto-retry
            # an uncertain email write. One alert per stage/day limits repeated noise.
            alert_key = f'{now.date()}:{stage}'
            attempts = health.setdefault('alertAttempts', {})
            if alert_key not in attempts:
                attempts[alert_key] = 'started'
                health['alertAttempts'] = dict(sorted(attempts.items())[-50:])
                write_json(health_path, health)
                try:
                    from alert import send_alert
                    send_alert(stage, now.isoformat())
                    health['lastAlertStatus'] = 'sent'
                except Exception:
                    health['lastAlertStatus'] = 'failed-or-uncertain'
                health['alertAttempts'][alert_key] = health['lastAlertStatus']
                write_json(health_path, health)
        print(json.dumps({'status': 'failed', 'stage': stage,
                          'action': 'Refresh NotebookLM login if authentication failed; inspect publication before retrying.'}), flush=True)
        return 1


def main():
    os.umask(0o077)
    directory = Path(os.environ.get('AUTOMATION_PRIVATE_DIR', '/data/podcast'))
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / 'maintenance.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Maintenance already running; skipping overlapping invocation.')
            return 0
        return maintain(directory, datetime.now(timezone.utc), os.environ)


if __name__ == '__main__':
    raise SystemExit(main())
