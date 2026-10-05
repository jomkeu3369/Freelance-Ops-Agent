"""Authenticated, bounded extraction. No originals are written to disk or logs."""

import asyncio
import json
import os
import sys
from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import Field, ValidationError

from api.assumptions.router import BearerDependency, VerifierDependency, _problem
from contracts import StrictModel, TrustedRunContext
from security import DelegationTokenVerifier, TokenVerificationError

router = APIRouter(prefix="/internal/v1/attachments", tags=["Attachments"])
_slots = asyncio.Semaphore(2)


class FileInput(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    media_type: str = Field(max_length=100)
    base64: str = Field(min_length=1, max_length=2_796_204)
    encoding: str = Field(default="auto", max_length=10)
    delimiter: str = Field(default="auto", max_length=4)


class ExtractInput(StrictModel):
    context: TrustedRunContext
    file: FileInput


async def run_reader(file: FileInput) -> dict:  # type: ignore[type-arg]
    # Strip credentials/environment from the parser child. No shell or filename arguments.
    environment = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "PATH", "TEMP", "TMP") if key in os.environ}
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        str(Path(__file__).with_name("worker.py")),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=environment,
        creationflags=0x08000000 if os.name == "nt" else 0,
    )
    try:
        async with asyncio.timeout(15):
            stdout, _ = await process.communicate(file.model_dump_json(by_alias=True).encode())
        if process.returncode != 0 or len(stdout) > 600_000:
            raise ValueError("PARSER_RESOURCE_LIMIT")
        return json.loads(stdout)  # type: ignore[no-any-return]
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


@router.post("/extract")
async def extract_attachment(request: Request, credentials: BearerDependency, verifier: VerifierDependency):  # type: ignore[no-untyped-def]  # noqa: E501
    if credentials is None or credentials.scheme.lower() != "bearer":
        return _problem(401, "Delegation required", "DELEGATION_TOKEN_REQUIRED")
    try:
        principal = verifier.verify(credentials.credentials)
        if not {"agent.run", "project.read"}.issubset(principal.permissions):
            return _problem(403, "Delegation forbidden", "DELEGATION_FORBIDDEN")
    except TokenVerificationError:
        return _problem(403, "Delegation forbidden", "DELEGATION_FORBIDDEN")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 2_800_000:
            return _problem(413, "File size limit", "FILE_SIZE_LIMIT")
    try:
        body = ExtractInput.model_validate_json(raw)
        DelegationTokenVerifier.authorize_run(principal, run_id=body.context.run_id, permission="agent.run")
        if (
            principal.workspace_id != body.context.workspace_id
            or principal.project_id != body.context.project_id
            or principal.initiated_by != body.context.initiated_by
            or not set(body.context.effective_permissions).issubset(principal.permissions)
        ):
            return _problem(403, "Context exceeds authority", "DELEGATION_FORBIDDEN")
    except (ValidationError, TokenVerificationError):
        return _problem(400, "Invalid attachment request", "INVALID_ATTACHMENT")
    try:
        async with asyncio.timeout(0.2):
            await _slots.acquire()
    except TimeoutError:
        return _problem(429, "Reader busy; retry later", "READER_BUSY")
    try:
        result = await run_reader(body.file)
        if "error" in result:
            return _problem(422, "File cannot be safely read", result["error"])
        return result
    except TimeoutError:
        return _problem(422, "Reader time limit", "READER_TIMEOUT")
    except (OSError, ValueError):
        return _problem(422, "Reader resource limit", "PARSER_RESOURCE_LIMIT")
    finally:
        _slots.release()
