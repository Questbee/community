from pydantic import BaseModel, ConfigDict
from datetime import datetime


class FormCreate(BaseModel):
    project_id: str
    name: str
    schema_json: dict = {"version": 1, "title": "", "fields": []}


class FormUpdate(BaseModel):
    schema_json: dict


class FormVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    version_num: int
    schema_json: dict
    published_at: datetime | None


class FormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    project_id: str
    current_version_id: str | None
    # current_version populated by router
