"""
voice_idiosyncrasy_job.py
==========================

Background job to extract voice idiosyncrasies for a client and persist them
to ClientContext.

Recommended schedule: nightly cron, one run per client per platform with
>= 10 posts on that platform.

Usage:
    from voice_idiosyncrasy_job import run_extraction_for_client

    await run_extraction_for_client(
        client_id=client.id,
        platform=Platform.LINKEDIN,
        context_repository=ctx_repo,
    )

Version: 1.0 (Phase 1.5)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

from client_context import (
    AuditEntry,
    ClientContext,
    Platform,
)
from voice_idiosyncrasy_extractor import extract_voice_idiosyncrasies


class ContextRepository(Protocol):
    """Minimal contract for the storage layer that persists ClientContexts."""

    async def get(self, client_id: UUID) -> ClientContext: ...

    async def save(self, context: ClientContext) -> None: ...


async def run_extraction_for_client(
    *,
    client_id: UUID,
    platform: Platform,
    context_repository: ContextRepository,
    operator_id: str = "system:nightly_extraction",
) -> bool:
    """Extract voice idiosyncrasies for a single (client, platform) pair
    and persist to ClientContext.

    Returns True if idiosyncrasies were updated, False if not enough posts
    or extraction returned None.
    """
    ctx = await context_repository.get(client_id)
    slots = ctx.get_platform_slots(platform)

    # Use voice_fingerprint as the source posts for extraction
    posts = slots.voice_fingerprint
    if len(posts) < 10:
        return False

    new_idiosyncrasies = extract_voice_idiosyncrasies(posts)
    if new_idiosyncrasies is None:
        return False

    previous = slots.voice_idiosyncrasies
    slots.voice_idiosyncrasies = new_idiosyncrasies

    ctx.audit_log.append(
        AuditEntry(
            action="voice_idiosyncrasies_extracted",
            platform=platform,
            previous_value=previous.model_dump() if previous else None,
            new_value=new_idiosyncrasies.model_dump(),
            operator_id=operator_id,
            notes=f"sample_size={new_idiosyncrasies.sample_size}",
        )
    )
    ctx.updated_at = datetime.now(timezone.utc)

    await context_repository.save(ctx)
    return True


async def run_extraction_for_all_clients(
    *,
    client_ids: list[UUID],
    platforms: list[Platform],
    context_repository: ContextRepository,
) -> dict[tuple[UUID, Platform], bool]:
    """Batch extraction across multiple clients and platforms. Use as the
    nightly job entry point.

    Returns a dict of (client_id, platform) -> bool indicating which combos
    were updated.
    """
    results: dict[tuple[UUID, Platform], bool] = {}
    for client_id in client_ids:
        for platform in platforms:
            try:
                updated = await run_extraction_for_client(
                    client_id=client_id,
                    platform=platform,
                    context_repository=context_repository,
                )
                results[(client_id, platform)] = updated
            except Exception:
                results[(client_id, platform)] = False
    return results
