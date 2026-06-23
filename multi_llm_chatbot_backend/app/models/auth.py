from typing import Optional

from pydantic import BaseModel, model_validator


class MessageResponse(BaseModel):
    message: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @model_validator(mode="after")
    def passwords_must_differ(self):
        if self.current_password == self.new_password:
            raise ValueError("New password must be different from the current password")
        return self


class UpdateProfileRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None

    @model_validator(mode="after")
    def at_least_one_field(self):
        if self.first_name is not None:
            self.first_name = self.first_name.strip() or None
        if self.last_name is not None:
            self.last_name = self.last_name.strip() or None
        if self.first_name is None and self.last_name is None:
            raise ValueError("At least one field must be provided")
        return self


class DeleteAccountRequest(BaseModel):
    password: str
