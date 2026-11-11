import io
import qrcode
import qrcode.image.svg
from fastapi import APIRouter
from fastapi.responses import FileResponse, Response

def create_router(runtime):
    router = APIRouter()

    @router.get('/')
    @router.get('/tv')
    async def tv():
        return FileResponse(runtime.root / "static/tv.html")

    @router.get('/remote')
    async def remote():
        return FileResponse(runtime.root / "static/remote.html")

    @router.get('/api/config')
    async def config():
        return {"remote_url": runtime.remote_url(), "version": runtime.project_version(), "update": runtime.updates.info, "update_check_complete": runtime.updates.check_complete}

    @router.get('/api/qr.svg')
    async def qr():
        out = io.BytesIO()
        qrcode.make(runtime.remote_url(), image_factory=qrcode.image.svg.SvgPathImage).save(out)
        return Response(out.getvalue(), media_type="image/svg+xml")

    return router
