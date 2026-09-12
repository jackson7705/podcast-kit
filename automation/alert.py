"""Send sanitized operator alerts through the connected Composio Gmail CLI."""
import json
import os
from pathlib import Path
import subprocess


def send_alert(stage, at, test=False):
    bootstrap = os.environ.get('COMPOSIO_USER_DATA_JSON')
    if bootstrap:
        destination = Path.home() / '.composio/user_data.json'
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        destination.write_text(json.dumps(json.loads(bootstrap)))
        destination.chmod(0o600)
    payload = {
        'recipient_email': 'jason.jackson@locafy.com',
        'from_email': 'jason@airsenseenvironmental.com',
        'subject': 'Air Sense podcast: alert delivery test' if test else f'Air Sense podcast needs attention: {stage}',
        'body': ('This is a test of the Air Sense podcast failure alert. No episode failure is being reported.'
                 if test else f'The Air Sense podcast automation failed during {stage} at {at}. '
                 'If authentication failed, sign into NotebookLM again and replace the Railway NOTEBOOKLM_AUTH_JSON secret. '
                 'For publication failures, inspect the live feed before rerunning to avoid duplicates.')
                 + '\n\nRailway: https://railway.com/project/aae4d4d5-8044-46ae-b42a-80d2e62ca2f0'
                 + '\nFeed: https://airsenseenvironmental.com/podcast/feed.xml',
        'is_html': False,
    }
    result = subprocess.run(['composio', 'execute', 'GMAIL_SEND_EMAIL', '-d', '-'],
                            input=json.dumps(payload), capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError('Alert send failed; inspect Composio delivery before retrying')
    value = json.loads(result.stdout)
    if value.get('successful') is False or value.get('error'):
        raise RuntimeError('Alert provider rejected send')
    return True


if __name__ == '__main__':
    send_alert('test', '', test=True)
    print('Alert delivery test accepted by Gmail.')
