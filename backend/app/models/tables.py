from sqlalchemy import Column, DateTime, Float, Integer

from app.core.database import Base


class MossData(Base):
    __tablename__ = "moss_data"

    id = Column(Integer, primary_key=True, index=True)
    outdoor_temp = Column(Float, nullable=False)
    outdoor_humidity = Column(Float, nullable=False)
    moss_surface_temp = Column(Float, nullable=False)
    near_moss_temp = Column(Float, nullable=False)
    near_moss_humidity = Column(Float, nullable=False)
    wall_temp = Column(Float, nullable=False)
    timestamp = Column("timestamp", DateTime, nullable=False, index=True)


class NonMossData(Base):
    __tablename__ = "non_moss_data"

    id = Column(Integer, primary_key=True, index=True)
    non_moss_surface_temp = Column(Float, nullable=False)
    near_non_moss_temp = Column(Float, nullable=False)
    near_non_moss_humidity = Column(Float, nullable=False)
    wall_temp = Column(Float, nullable=False)
    timestamp = Column("timestamp", DateTime, nullable=False, index=True)
