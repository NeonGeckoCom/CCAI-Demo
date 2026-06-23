from pydantic import BaseModel


class ProviderSwitch(BaseModel):
    provider: str
