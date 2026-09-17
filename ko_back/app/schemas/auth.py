from pydantic import BaseModel, Field

from app.models.user import UserRole


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: str
    role: UserRole
