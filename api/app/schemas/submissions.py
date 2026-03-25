from pydantic import BaseModel, ConfigDict
from datetime import datetime


class SubmissionCreate(BaseModel):
    form_version_id: str
    local_uuid: str | None = None
    data_json: dict
    collected_at: datetime | None = None
    device_id: str | None = None
    # user_id sent by the mobile app after the user logs in on the device
    user_id: str | None = None


class BulkSubmissionRequest(BaseModel):
    submissions: list[SubmissionCreate]


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    form_version_id: str
    local_uuid: str | None
    data_json: dict
    collected_at: datetime | None
    submitted_at: datetime
