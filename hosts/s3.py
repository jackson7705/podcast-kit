"""Plain S3 backend. Use with CloudFront (or any CDN) in front — S3 alone bills egress,
which for podcast audio is the entire cost.

.env:  S3_BUCKET, S3_REGION, S3_PUBLIC_BASE, and normal AWS credentials in the environment
"""
REQUIRED = ["S3_BUCKET", "S3_REGION", "S3_PUBLIC_BASE"]


def put(env, key, path, content_type):
    import boto3
    boto3.client("s3", region_name=env["S3_REGION"]).put_object(
        Bucket=env["S3_BUCKET"], Key=key, Body=path.read_bytes(), ContentType=content_type
    )
    return f"{env['S3_PUBLIC_BASE'].rstrip('/')}/{key}"
