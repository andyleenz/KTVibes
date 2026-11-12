import io
import base64
import os
import xml.etree.ElementTree as ET
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
        return {"remote_url": runtime.remote_url(), "port": runtime.port, "instance_id": os.environ.get('KTVIBES_INSTANCE_ID'), "version": runtime.project_version(), "update": runtime.updates.info, "update_check_complete": runtime.updates.check_complete}

    @router.get('/api/qr.svg')
    async def qr(branded: bool = False):
        out = io.BytesIO()
        code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H if branded else qrcode.constants.ERROR_CORRECT_M)
        code.add_data(runtime.remote_url())
        code.make(fit=True)
        code.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(out)
        if branded:
            svg = ET.fromstring(out.getvalue())
            ns = '{http://www.w3.org/2000/svg}'
            _, _, width, _ = map(float, svg.attrib['viewBox'].split())
            svg.insert(0, ET.Element(ns + 'rect', x='0', y='0', width=str(width), height=str(width), fill='white'))
            size = width * .2
            offset = (width - size) / 2
            ET.SubElement(svg, ns + 'rect', x=str(offset), y=str(offset), width=str(size), height=str(size), fill='white')
            padding = size * .08
            icon = base64.b64encode((runtime.root / 'static/apple-touch-icon.png').read_bytes()).decode('ascii')
            ET.SubElement(svg, ns + 'image', x=str(offset + padding), y=str(offset + padding),
                          width=str(size - 2 * padding), height=str(size - 2 * padding),
                          href='data:image/png;base64,' + icon)
            return Response(ET.tostring(svg), media_type="image/svg+xml")
        return Response(out.getvalue(), media_type="image/svg+xml")

    return router
