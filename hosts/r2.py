"""Cloudflare R2 backend (S3-compatible).

The default, for two reasons: zero egress fees, which matches podcast audio exactly, and
overwrite-in-place, which keeps every URL stable forever. Podcast feed URLs are a one-way
door — Apple and Spotify poll one URL for the life of the show — so stable keys are not a
convenience, they are the whole requirement.

Needs a custom domain on the bucket. The r2.dev development URL is rate-limited and
explicitly not for production traffic; do not launch a show on it.

.env:  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE
"""
REQUIRED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE"]


def client(env):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def put(env, key, path, content_type):
    client(env).put_object(
        Bucket=env["R2_BUCKET"], Key=key, Body=path.read_bytes(), ContentType=content_type
    )
    return f"{env['R2_PUBLIC_BASE'].rstrip('/')}/{key}"
