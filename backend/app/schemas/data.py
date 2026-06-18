from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class MossDataCreate(BaseModel):
    node: Literal["moss"] = "moss"
    outdoorTemp: Optional[float] = None
    outdoorHumidity: Optional[float] = None
    mossSurfaceTemp: Optional[float] = None
    nearMossTemp: Optional[float] = None
    nearMossHumidity: Optional[float] = None
    wallTemp: Optional[float] = None
    timestamp: Optional[datetime] = None


class NonMossDataCreate(BaseModel):
    node: Literal["non_moss"] = "non_moss"
    nonMossSurfaceTemp: Optional[float] = None
    nearNonMossTemp: Optional[float] = None
    nearNonMossHumidity: Optional[float] = None
    wallTemp: Optional[float] = None
    timestamp: Optional[datetime] = None


class MossDataRead(BaseModel):
    id: int
    outdoorTemp: Optional[float] = None
    outdoorHumidity: Optional[float] = None
    mossSurfaceTemp: Optional[float] = None
    nearMossTemp: Optional[float] = None
    nearMossHumidity: Optional[float] = None
    wallTemp: Optional[float] = None
    timestamp: datetime


class NonMossDataRead(BaseModel):
    id: int
    nonMossSurfaceTemp: Optional[float] = None
    nearNonMossTemp: Optional[float] = None
    nearNonMossHumidity: Optional[float] = None
    wallTemp: Optional[float] = None
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


class MergedRow(BaseModel):
    timestamp: Optional[datetime] = None
    outdoorTemp: Optional[float] = None
    outdoorHumidity: Optional[float] = None
    mossSurfaceTemp: Optional[float] = None
    nearMossTemp: Optional[float] = None
    nearMossHumidity: Optional[float] = None
    mossWallTemp: Optional[float] = None
    nonMossSurfaceTemp: Optional[float] = None
    nearNonMossTemp: Optional[float] = None
    nearNonMossHumidity: Optional[float] = None
    nonMossWallTemp: Optional[float] = None


class PaginatedHistoryResponse(BaseModel):
    rows: list[MergedRow]
    page: int
    perPage: int
    totalRows: int
    totalPages: int


class MetricComparison(BaseModel):
    mossAverage: Optional[float] = None
    nonMossAverage: Optional[float] = None
    difference: Optional[float] = None


class CompareResponse(BaseModel):
    surfaceTemperature: MetricComparison
    nearAirTemperature: MetricComparison
    nearAirHumidity: MetricComparison
    wallTemperature: MetricComparison


# ── Analysis report schemas ─────────────────────────────────────────

class AnalysisTimeSeriesRow(BaseModel):
    timestamp: Optional[str] = None
    outdoorTemp: Optional[float] = None
    outdoorHumidity: Optional[float] = None
    mossSurfaceTemp: Optional[float] = None
    nearMossTemp: Optional[float] = None
    nearMossHumidity: Optional[float] = None
    mossWallTemp: Optional[float] = None
    nonMossSurfaceTemp: Optional[float] = None
    nearNonMossTemp: Optional[float] = None
    nearNonMossHumidity: Optional[float] = None
    nonMossWallTemp: Optional[float] = None


class DescriptiveStatRow(BaseModel):
    sensor: str
    mean: Optional[float] = None
    std: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None


class DiurnalRow(BaseModel):
    period: str
    mossWall: Optional[float] = None
    nonMossWall: Optional[float] = None
    diff: Optional[float] = None


class CoolingEffect(BaseModel):
    mossCooling: Optional[float] = None
    nonMossCooling: Optional[float] = None
    mossAdvantage: Optional[float] = None


class HumidityBufferingRow(BaseModel):
    location: str
    stdDev: Optional[float] = None
    interpretation: str


class HourlyPatternRow(BaseModel):
    hour: int
    mossWall: Optional[float] = None
    nonMossWall: Optional[float] = None
    outdoor: Optional[float] = None


class AnalysisResponse(BaseModel):
    timeSeries: list[AnalysisTimeSeriesRow]
    descriptiveStats: list[DescriptiveStatRow]
    diurnal: list[DiurnalRow]
    cooling: CoolingEffect
    humidityBuffering: list[HumidityBufferingRow]
    hourlyPattern: list[HourlyPatternRow]

