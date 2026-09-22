from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.models import User
from app.schemas import UserOut

router = APIRouter(prefix="/me", tags=["users"])


@router.get("", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)):
    return user
