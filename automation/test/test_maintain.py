import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock
from datetime import datetime

spec = importlib.util.spec_from_file_location('maintain', Path(__file__).parents[1] / 'maintain.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.env = {'NOTEBOOKLM_AUTH_JSON': json.dumps({'cookies': [{'value': 'secret'}]})}
        self.monday = datetime.fromisoformat('2026-09-14T14:00:00+00:00')
        self.calls = []

    def run_ok(self, args, env, timeout):
        self.assertNotIn('NOTEBOOKLM_AUTH_JSON', env)
        self.calls.append(args)
        output = {'status': 'ok', 'checks': {'token_fetch': True}}
        if 'r2_state.py' in ' '.join(args):
            output = {'runs': []}
        return subprocess.CompletedProcess(args, 0, json.dumps(output), '')

    def test_rotations_survive_and_new_bootstrap_replaces(self):
        m.prepare_auth(self.directory, dict(self.env))
        storage = self.directory / 'notebooklm/profiles/default/storage_state.json'
        m.write_json(storage, {'cookies': [{'value': 'rotated'}]})
        m.prepare_auth(self.directory, dict(self.env))
        self.assertEqual(m.read_json(storage)['cookies'][0]['value'], 'rotated')
        m.prepare_auth(self.directory, {'NOTEBOOKLM_AUTH_JSON': '{"cookies":[{"value":"new"}]}'})
        self.assertEqual(m.read_json(storage)['cookies'][0]['value'], 'new')
        self.assertEqual(storage.stat().st_mode & 0o777, 0o600)

    def test_master_token_alone_is_enough_and_replaces_stale_cookies(self):
        profile = self.directory / 'notebooklm/profiles/default'
        token_env = {'NOTEBOOKLM_MASTER_TOKEN_JSON': json.dumps({'master_token': 'aas_et/one', 'email': 'a@b'})}
        env = m.prepare_auth(self.directory, dict(token_env))
        self.assertNotIn('NOTEBOOKLM_MASTER_TOKEN_JSON', env)
        self.assertEqual(m.read_json(profile / 'master_token.json')['master_token'], 'aas_et/one')
        self.assertEqual((profile / 'master_token.json').stat().st_mode & 0o777, 0o600)
        self.assertFalse((profile / 'storage_state.json').exists())  # minted by `auth refresh`
        # cookies the CLI mints later survive an unchanged token on the next start
        m.write_json(profile / 'storage_state.json', {'cookies': [{'value': 'minted'}]})
        m.prepare_auth(self.directory, dict(token_env))
        self.assertEqual(m.read_json(profile / 'storage_state.json')['cookies'][0]['value'], 'minted')
        # a re-issued token drops cookies minted from the old one
        m.prepare_auth(self.directory, {'NOTEBOOKLM_MASTER_TOKEN_JSON': json.dumps({'master_token': 'aas_et/two'})})
        self.assertFalse((profile / 'storage_state.json').exists())
        # both secrets together: the token wins, a stale cookie snapshot is ignored
        env = m.prepare_auth(self.directory, {**token_env, 'NOTEBOOKLM_AUTH_JSON': json.dumps({'cookies': [{'value': 'snap'}]})})
        self.assertFalse((profile / 'storage_state.json').exists())
        self.assertNotIn('NOTEBOOKLM_AUTH_JSON', env)
        # cookies that belong to another account are dropped; same-account cookies stay
        m.write_json(profile / 'storage_state.json', {'cookies': [{'value': 'x'}], 'notebooklm': {'account': {'email': 'other@locafy.com'}}})
        m.prepare_auth(self.directory, dict(token_env))
        self.assertFalse((profile / 'storage_state.json').exists())
        m.write_json(profile / 'storage_state.json', {'cookies': [{'value': 'x'}], 'notebooklm': {'account': {'email': 'A@B'}}})
        m.prepare_auth(self.directory, dict(token_env))
        self.assertTrue((profile / 'storage_state.json').exists())
        with self.assertRaises(ValueError):
            m.prepare_auth(self.directory, {'NOTEBOOKLM_MASTER_TOKEN_JSON': '"not a dict"'})

    def test_three_monday_invocations_only_publish_once(self):
        for minute in [0, 20, 40]:
            self.assertEqual(m.maintain(self.directory, self.monday.replace(minute=minute), self.env, self.run_ok), 0)
        self.assertEqual(sum(a[0] == 'node' for a in self.calls), 1)
        self.assertIn('--force-schedule', next(a for a in self.calls if a[0] == 'node'))
        self.assertEqual(sum('refresh' in a for a in self.calls), 3)

    def test_failed_auth_records_failure_without_consuming_day(self):
        def fail(args, env, timeout):
            return subprocess.CompletedProcess(args, 1, 'sensitive-cookie', 'sensitive-error')
        self.assertEqual(m.maintain(self.directory, self.monday, self.env, fail), 1)
        health = m.read_json(self.directory / 'health.json')
        self.assertEqual(health['failureStage'], 'authentication')
        self.assertNotIn('sensitive', json.dumps(health))
        self.assertTrue(m.publication_due(self.monday, health))

    def test_publication_failure_is_not_retried_automatically(self):
        def fail_publish(args, env, timeout):
            result = self.run_ok(args, env, timeout)
            if args[0] == 'node':
                result.returncode = 1
            return result
        self.assertEqual(m.maintain(self.directory, self.monday, self.env, fail_publish), 1)
        self.assertEqual(m.maintain(self.directory, self.monday.replace(minute=20), self.env, fail_publish), 1)
        self.assertEqual(sum(a[0] == 'node' for a in self.calls), 1)
        self.assertEqual(m.read_json(self.directory / 'health.json')['dailyAttempts']['2026-09-14'], 'failed')

    def test_manual_publication_history_prevents_duplicate(self):
        def completed(args, env, timeout):
            result = self.run_ok(args, env, timeout)
            if 'r2_state.py' in ' '.join(args):
                result.stdout = json.dumps({'runs': [{'at': self.monday.isoformat(), 'result': 'published'}]})
            return result
        self.assertEqual(m.maintain(self.directory, self.monday, self.env, completed), 0)
        self.assertFalse(any(a[0] == 'node' for a in self.calls))

    def test_schedule_handles_winter_and_other_days(self):
        self.assertTrue(m.publication_due(datetime.fromisoformat('2026-12-07T15:20:00+00:00'), {}))
        self.assertFalse(m.publication_due(datetime.fromisoformat('2026-12-07T14:20:00+00:00'), {}))
        self.assertTrue(m.publication_due(datetime.fromisoformat('2026-09-10T14:20:00+00:00'), {}))

    def test_next_day_runs_even_after_no_new_article_yesterday(self):
        def yesterday(args, env, timeout):
            result = self.run_ok(args, env, timeout)
            if 'r2_state.py' in ' '.join(args):
                result.stdout = json.dumps({'runs': [{'at': self.monday.isoformat(), 'result': 'no-new-article'}]})
            return result
        m.maintain(self.directory, self.monday, self.env, self.run_ok)
        m.maintain(self.directory, self.monday.replace(day=15), self.env, yesterday)
        self.assertEqual(sum(a[0] == 'node' for a in self.calls), 2)

    def test_legacy_uncertain_attempt_blocks_publication(self):
        m.write_json(self.directory / 'health.json', {'weeklyAttempts': {'2026-W37': 'started'}})
        self.assertEqual(m.maintain(self.directory, self.monday, self.env, self.run_ok), 1)
        self.assertFalse(any(a[0] == 'node' for a in self.calls))

    def test_schedule_weekend_catchup_and_local_date(self):
        self.assertTrue(m.publication_due(datetime.fromisoformat('2026-09-12T20:00:00+00:00'), {}))
        self.assertEqual(m.day_key(datetime.fromisoformat('2026-09-13T01:00:00+00:00')), '2026-09-12')
        self.assertFalse(m.publication_due(self.monday, {'dailyAttempts': {'2026-09-13': 'failed'}}))

    def test_uncertain_alert_is_not_sent_twice(self):
        import types
        alert = Mock(side_effect=TimeoutError('unknown send outcome'))
        env = {**self.env, 'AUTOMATION_EMAIL_ALERTS': '1'}
        def fail(args, env, timeout):
            return subprocess.CompletedProcess(args, 1, '', '')
        with patch.dict('sys.modules', {'alert': types.SimpleNamespace(send_alert=alert)}):
            for minute in [0, 20]:
                self.assertEqual(m.maintain(self.directory, self.monday.replace(minute=minute), env, fail), 1)
        self.assertEqual(alert.call_count, 1)
        self.assertEqual(m.read_json(self.directory / 'health.json')['lastAlertStatus'], 'failed-or-uncertain')

    def test_alternating_failure_stages_do_not_repeat_uncertain_alert(self):
        import types
        alert = Mock(side_effect=TimeoutError('unknown outcome'))
        env = {**self.env, 'AUTOMATION_EMAIL_ALERTS': '1'}
        def fail(args, env, timeout):
            return subprocess.CompletedProcess(args, 1, '', '')
        with patch.dict('sys.modules', {'alert': types.SimpleNamespace(send_alert=alert)}):
            m.maintain(self.directory, self.monday, env, fail)
            m.maintain(self.directory, self.monday, {**env, 'NOTEBOOKLM_AUTH_JSON': 'invalid'}, fail)
            m.maintain(self.directory, self.monday, env, fail)
        self.assertEqual(alert.call_count, 2)

    def test_corrupt_ledger_fails_closed_without_publishing(self):
        (self.directory / 'health.json').write_text('broken')
        self.assertEqual(m.maintain(self.directory, self.monday, self.env, self.run_ok), 1)
        self.assertFalse(self.calls)
        health = m.read_json(self.directory / 'health.json')
        self.assertEqual(health['failureStage'], 'health-storage')
        self.assertFalse(m.publication_due(self.monday, health))


if __name__ == '__main__':
    unittest.main()
