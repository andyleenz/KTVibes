"""Application-owned tasks must not survive application shutdown."""
import asyncio
import unittest
from pathlib import Path
from ktvibes.runtime import Runtime


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_close_cancels_pending_plain_lyrics_lookup(self):
        runtime = Runtime(cache=Path('/unused-cache'))
        started = asyncio.Event()

        async def lookup():
            started.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(lookup())
        runtime.lyrics.lookups[('video', 'identity')] = task
        await started.wait()
        await runtime.lyrics.close()
        self.assertTrue(task.cancelled())
        self.assertFalse(runtime.lyrics.lookups)
