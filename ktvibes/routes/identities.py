from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from ..identities import AVATARS

class IdentityBody(BaseModel):
    name: str = Field(min_length=1, max_length=12)
    avatar: str

class IdentityOrder(BaseModel):
    ids: list[str]

def create_router(runtime):
    router = APIRouter()

    @router.get('/api/identities')
    async def list_identities():
        return {"identities": runtime.identities.items, "avatars": AVATARS}

    @router.post('/api/identities', status_code=201)
    async def create_identity(body: IdentityBody):
        try: return runtime.identities.create(body.name, body.avatar)
        except ValueError as exc: raise HTTPException(422, str(exc)) from exc

    @router.put('/api/identities/order')
    async def reorder_identities(body: IdentityOrder):
        try: return runtime.identities.reorder(body.ids)
        except ValueError as exc: raise HTTPException(409, str(exc)) from exc

    @router.patch('/api/identities/{identity_id}')
    async def update_identity(identity_id: str, body: IdentityBody):
        try: return runtime.identities.update(identity_id, body.name, body.avatar)
        except KeyError as exc: raise HTTPException(404, 'Identity not found') from exc
        except ValueError as exc: raise HTTPException(422, str(exc)) from exc

    @router.delete('/api/identities/{identity_id}', status_code=204)
    async def delete_identity(identity_id: str):
        try: runtime.identities.delete(identity_id)
        except KeyError as exc: raise HTTPException(404, 'Identity not found') from exc

    return router
