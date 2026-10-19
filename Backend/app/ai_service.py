import os
import json
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

# Pydantic schema for structured JSON output
class RouteSafetyAssessment(BaseModel):
    safety_score: int = Field(description="Safety score integer between 50 and 100")
    verdict: str = Field(description="Short verdict like 'Low Risk' or 'Caution Advised'")
    lighting_rating: str = Field(description="Street illumination status")
    police_presence: str = Field(description="Police or patrol status")
    summary: str = Field(description="Exactly one sentence describing pedestrian conditions on this route")

def evaluate_route_safety(origin: str, destination: str, nearby_hazards: list[str]) -> dict:
    api_key = os.getenv("GEMINI_API_KEY")

    fallback_response = {
        "safety_score": 88,
        "verdict": "Safe Route",
        "lighting_rating": "Adequate Street Lighting",
        "police_presence": "Normal Patrol Zone",
        "summary": f"Direct route selected between {origin} and {destination} along primary walkable roads."
    }

    if not api_key:
        print("\n❌ [GEMINI ERROR]: GEMINI_API_KEY is not exported in this shell.\n")
        return fallback_response

    try:
        client = genai.Client(api_key=api_key)
    except Exception as init_err:
        print(f"\n❌ [GEMINI CLIENT INIT FAILED]: {init_err}\n")
        return fallback_response

    prompt = f"""
    Analyze pedestrian and nocturnal safety for this specific route option:
    - Route Option & Origin: {origin}
    - Destination: {destination}
    - Route Telemetry & Infrastructure Data: {', '.join(nearby_hazards)}

    Write a distinct 1-sentence summary tailored to this specific route's lighting, road type, and distance.
    """

    # Active production models
    models_to_try = ["gemini-3.5-flash-lite", "gemini-3.8-flash"]

    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=RouteSafetyAssessment,
                    temperature=0.5,
                ),
            )
            data = json.loads(response.text)
            print(f"\n✅ [GEMINI SUCCESS]: Live safety evaluation generated using {model_name}!")
            return data
        except Exception as e:
            print(f"\n⚠️ [{model_name} FAILED]: {type(e).__name__} - {e}")
            continue

    print("\n❌ [GEMINI ERROR]: All models failed. Falling back to default template.\n")
    return fallback_response
