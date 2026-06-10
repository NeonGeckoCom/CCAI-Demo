"""Mongo-backed user-specific advisor skills."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from app.advisor_skills.registry import (
    ADVISOR_SKILLS,
    AdvisorSkill,
    build_generated_advisor_skill,
)

COLLECTION_NAME = "user_advisor_skills"


def _collection():
    from app.core.database import get_database

    return get_database()[COLLECTION_NAME]


def _object_id_cls():
    try:
        from bson import ObjectId
    except ImportError as exc:
        raise RuntimeError(
            "pymongo/bson is required for user-specific advisor skills"
        ) from exc
    return ObjectId


def _coerce_user_id(user_id: Any) -> Any:
    ObjectId = _object_id_cls()
    if isinstance(user_id, ObjectId):
        return user_id
    if isinstance(user_id, str) and ObjectId.is_valid(user_id):
        return ObjectId(user_id)
    raise ValueError("Invalid user_id")


def serialize_advisor_skill(skill: AdvisorSkill, *, scope: str = "user") -> Dict[str, Any]:
    """Return a frontend/API friendly representation of an advisor skill."""
    budgets = skill.metadata.get("token_budgets", {})
    return {
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "use_when": skill.use_when,
        "preferred_advisors": skill.preferred_advisors,
        "rag_policy": skill.rag_policy,
        "token_budgets": budgets if isinstance(budgets, dict) else {},
        "how_to_work": skill.how_to_work,
        "headings": skill.headings,
        "heading_details": skill.heading_details,
        "markdown": skill.markdown,
        "scope": scope,
        "source_path": str(skill.source_path) if skill.source_path else None,
    }


def _skill_doc_to_skill(doc: Dict[str, Any]) -> AdvisorSkill:
    return AdvisorSkill(
        id=doc["skill_id"],
        name=doc["name"],
        markdown=doc["markdown"],
        metadata=doc.get("metadata", {}),
        source_path=None,
    )


def _skill_to_doc(skill: AdvisorSkill, user_id: Any, spec: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.utcnow()
    return {
        "user_id": user_id,
        "skill_id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "markdown": skill.markdown,
        "metadata": skill.metadata,
        "spec": spec,
        "created_at": now,
        "updated_at": now,
        "is_active": True,
    }


async def list_user_advisor_skills(user_id: Any, *, include_inactive: bool = False) -> List[AdvisorSkill]:
    query: Dict[str, Any] = {"user_id": _coerce_user_id(user_id)}
    if not include_inactive:
        query["is_active"] = True

    cursor = _collection().find(query).sort("created_at", 1)
    docs = await cursor.to_list(length=500)
    return [_skill_doc_to_skill(doc) for doc in docs]


async def get_user_advisor_skill_map(user_id: Any) -> Dict[str, AdvisorSkill]:
    return {
        skill.id: skill
        for skill in await list_user_advisor_skills(user_id)
    }


async def get_effective_advisor_skills(user_id: Optional[Any] = None) -> Dict[str, AdvisorSkill]:
    """Return default skills plus active user-specific skills for one user."""
    skills = dict(ADVISOR_SKILLS)
    if user_id is not None:
        skills.update(await get_user_advisor_skill_map(user_id))
    return skills


async def create_user_advisor_skill(user_id: Any, spec: Dict[str, Any]) -> AdvisorSkill:
    user_object_id = _coerce_user_id(user_id)
    existing_ids = set(ADVISOR_SKILLS)
    existing_ids.update((await get_user_advisor_skill_map(user_object_id)).keys())
    skill = build_generated_advisor_skill(spec, existing_skill_ids=list(existing_ids))
    doc = _skill_to_doc(skill, user_object_id, {**spec, "id": skill.id})
    await _collection().insert_one(doc)
    return skill


async def update_user_advisor_skill(user_id: Any, skill_id: str, spec: Dict[str, Any]) -> Optional[AdvisorSkill]:
    user_object_id = _coerce_user_id(user_id)
    existing = await _collection().find_one({
        "user_id": user_object_id,
        "skill_id": skill_id,
        "is_active": True,
    })
    if not existing:
        return None

    merged = dict(existing.get("spec") or {})
    merged.setdefault("id", skill_id)
    merged.setdefault("name", existing.get("name"))
    merged.setdefault("description", existing.get("description"))
    merged.setdefault("use_when", _skill_doc_to_skill(existing).use_when)
    merged.setdefault("preferred_advisors", existing.get("metadata", {}).get("preferred_advisors", []))
    merged.setdefault("rag_policy", existing.get("metadata", {}).get("rag_policy", "optional"))
    merged.setdefault("token_budgets", existing.get("metadata", {}).get("token_budgets", {}))
    merged.update({key: value for key, value in spec.items() if value is not None})
    merged["id"] = skill_id

    skill = build_generated_advisor_skill(merged, existing_skill_ids=[sid for sid in ADVISOR_SKILLS if sid != skill_id])
    if skill.id != skill_id:
        skill = AdvisorSkill(
            id=skill_id,
            name=skill.name,
            markdown=skill.markdown,
            metadata={**skill.metadata, "id": skill_id},
            source_path=None,
        )

    await _collection().update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "name": skill.name,
                "description": skill.description,
                "markdown": skill.markdown,
                "metadata": skill.metadata,
                "spec": merged,
                "updated_at": datetime.utcnow(),
            }
        },
    )
    return skill


async def delete_user_advisor_skill(user_id: Any, skill_id: str) -> bool:
    result = await _collection().update_one(
        {
            "user_id": _coerce_user_id(user_id),
            "skill_id": skill_id,
            "is_active": True,
        },
        {"$set": {"is_active": False, "updated_at": datetime.utcnow()}},
    )
    return result.modified_count > 0
