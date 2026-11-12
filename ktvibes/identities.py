"""Small host-local identity store used to attribute remote queue requests."""
import json
import uuid
from pathlib import Path

AVATARS = tuple(f"avatar-{index:02d}" for index in range(1, 11))

class IdentityStore:
    def __init__(self, path: Path):
        self.path = path
        self.items = []
        self.load()

    def load(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self.items = [item for item in data if isinstance(item, dict) and item.get("id") and item.get("name") and item.get("avatar") in AVATARS]
        except (OSError, ValueError, TypeError):
            self.items = []

    def save(self, items=None):
        items = self.items if items is None else items
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)
        self.items = items

    def create(self, name, avatar):
        name = name.strip()
        if not name or len(name) > 12 or avatar not in AVATARS:
            raise ValueError("Choose a name (1–12 characters) and a valid avatar")
        item = {"id": uuid.uuid4().hex, "name": name, "avatar": avatar}
        self.save([*self.items, item])
        return item

    def update(self, identity_id, name, avatar):
        item = self.find(identity_id)
        if not item:
            raise KeyError(identity_id)
        name = name.strip()
        if not name or len(name) > 12 or avatar not in AVATARS:
            raise ValueError("Choose a name (1–12 characters) and a valid avatar")
        updated = {**item, "name": name, "avatar": avatar}
        self.save([updated if row["id"] == identity_id else row for row in self.items])
        return updated

    def delete(self, identity_id):
        item = self.find(identity_id)
        if not item:
            raise KeyError(identity_id)
        self.save([row for row in self.items if row["id"] != identity_id])

    def reorder(self, ids):
        existing = {item["id"]: item for item in self.items}
        if len(ids) != len(existing) or len(set(ids)) != len(ids) or set(ids) != set(existing):
            raise ValueError("Identities changed. Please try reordering again.")
        self.save([existing[identity_id] for identity_id in ids])
        return self.items

    def find(self, identity_id):
        return next((item for item in self.items if item["id"] == identity_id), None)

    def snapshot(self, identity_id):
        item = self.find(identity_id) if identity_id else None
        return {"id": item["id"], "name": item["name"], "avatar": item["avatar"]} if item else {"id": None, "name": "Guest", "avatar": None}
