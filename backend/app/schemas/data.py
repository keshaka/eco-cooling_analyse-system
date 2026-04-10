from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class MossDataCreate(BaseModel):
    node: Literal["moss"] = "moss"
    outdoorTemp: float
    outdoorHumidity: float
    mossSurfaceTemp: float
    nearMossTemp: float
    nearMossHumidity: float
    wallTemp: float
    timestamp: Optional[datetime] = None


class NonMossDataCreate(BaseModel):
    node: Literal["non_moss"] = "non_moss"
    nonMossSurfaceTemp: float
    nearNonMossTemp: float
    nearNonMossHumidity: float
    wallTemp: float
    timestamp: Optional[datetime] = None


class MossDataRead(BaseModel):
    id: int
    outdoorTemp: float
    outdoorHumidity: float
    mossSurfaceTemp: float
    nearMossTemp: float
    nearMossHumidity: float
    wallTemp: float
    timestamp: datetime


class NonMossDataRead(BaseModel):
    id: int
    nonMossSurfaceTemp: float
    nearNonMossTemp: float
    nearNonMossHumidity: float
    wallTemp: float
    timestamp: datetime


class LatestDataResponse(BaseModel):
    moss: Optional[MossDataRead] = None
    nonMoss: Optional[NonMossDataRead] = None
    coolingDeltaSurface: Optional[float] = None


class HistoryQuery(BaseModel):
    start: date = Field(..., description="Start date in YYYY-MM-DD format")
    end: date = Field(..., description="End date in YYYY-MM-DD format")

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.end < self.start:
            raise ValueError("end date must be greater than or equal to start date")
        return self


class HistoryResponse(BaseModel):
    moss: list[MossDataRead]
    nonMoss: list[NonMossDataRead]


class MetricComparison(BaseModel):
    mossAverage: Optional[float] = None
    nonMossAverage: Optional[float] = None
    difference: Optional[float] = None


class CompareResponse(BaseModel):
    surfaceTemperature: MetricComparison
    nearAirTemperature: MetricComparison
    nearAirHumidity: MetricComparison
    wallTemperature: MetricComparison
