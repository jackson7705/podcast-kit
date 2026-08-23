#!/usr/bin/env python3
"""Small R2 state helper for the weekly publisher.

State contains URLs, timestamps, and episode metadata only. Credentials stay in process
environment variables and never enter the state object.
"""

import argparse
import json
import os
import pathlib
import sys

from botocore.exceptions import ClientError

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hosts.r2 import REQUIRED, client  # noqa: E402


STATE_KEY = "_automation/weekly-state.json"


def environment():
    values = dict(os.environ)
    missing = [name for name in REQUIRED if not values.get(name)]
    if missing:
        raise SystemExit(f"Missing R2 environment variables: {', '.join(missing)}")
    return values


def is_missing(error):
    code = str(error.response.get("Error", {}).get("Code", ""))
    return code in {"NoSuchKey", "404", "NotFound"}


def get_state(storage, bucket):
    try:
        payload = storage.get_object(Bucket=bucket, Key=STATE_KEY)["Body"].read()
    except ClientError as error:
        if is_missing(error):
            return {"version": 1, "seen": [], "skipped": [], "runs": []}
        raise
    state = json.loads(payload)
    if not isinstance(state, dict):
        raise ValueError("R2 automation state must be a JSON object")
    state.setdefault("version", 1)
    state.setdefault("seen", [])
    state.setdefault("skipped", [])
    state.setdefault("runs", [])
    return state


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("get")
    put = sub.add_parser("put")
    put.add_argument("file", type=pathlib.Path)

    download = sub.add_parser("download")
    download.add_argument("key")
    download.add_argument("file", type=pathlib.Path)
    download.add_argument("--missing-ok", action="store_true")

    upload = sub.add_parser("upload")
    upload.add_argument("key")
    upload.add_argument("file", type=pathlib.Path)
    upload.add_argument("--content-type", default="application/octet-stream")

    args = parser.parse_args()
    values = environment()
    storage = client(values)
    bucket = values["R2_BUCKET"]

    if args.command == "get":
        print(json.dumps(get_state(storage, bucket)))
        return

    if args.command == "put":
        state = json.loads(args.file.read_text())
        payload = json.dumps(state, indent=2).encode()
        storage.put_object(Bucket=bucket, Key=STATE_KEY, Body=payload, ContentType="application/json")
        return

    if args.command == "download":
        try:
            body = storage.get_object(Bucket=bucket, Key=args.key)["Body"].read()
        except ClientError as error:
            if args.missing_ok and is_missing(error):
                return
            raise
        args.file.parent.mkdir(parents=True, exist_ok=True)
        args.file.write_bytes(body)
        return

    storage.put_object(
        Bucket=bucket,
        Key=args.key,
        Body=args.file.read_bytes(),
        ContentType=args.content_type,
    )


if __name__ == "__main__":
    main()
