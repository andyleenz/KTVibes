"""Validated HTTP request bodies shared by the route groups."""
import math
from pydantic import BaseModel, Field, field_validator

class Song(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    artist: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=300)
    identity_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")

    @field_validator("artist", "title")
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Artist and title must not be blank")
        return value


class LyricChoice(BaseModel):
    id: int


class OffsetChoice(BaseModel):
    value: float

    @field_validator("value")
    @classmethod
    def finite(cls, value):
        if not math.isfinite(value):
            raise ValueError("Expected a finite number")
        return value
