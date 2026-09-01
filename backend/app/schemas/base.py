from pydantic import BaseModel, ConfigDict


def to_camel(snake: str) -> str:
    head, *tail = snake.split("_")
    return head + "".join(word.capitalize() for word in tail)


class CamelModel(BaseModel):
    """Base schema: accepts snake_case or camelCase input, serialises camelCase.

    The frontend domain model (src/types) is camelCase, so every request and
    response body on the wire is camelCase while the Python code stays snake_case.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
