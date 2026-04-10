IF DB_ID(N'iot_monitoring') IS NULL
BEGIN
    CREATE DATABASE iot_monitoring;
END;
GO

USE iot_monitoring;
GO

IF OBJECT_ID(N'dbo.moss_data', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.moss_data (
        id INT IDENTITY(1,1) PRIMARY KEY,
        outdoor_temp FLOAT NOT NULL,
        outdoor_humidity FLOAT NOT NULL,
        moss_surface_temp FLOAT NOT NULL,
        near_moss_temp FLOAT NOT NULL,
        near_moss_humidity FLOAT NOT NULL,
        wall_temp FLOAT NOT NULL,
        [timestamp] DATETIME NOT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.non_moss_data', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.non_moss_data (
        id INT IDENTITY(1,1) PRIMARY KEY,
        non_moss_surface_temp FLOAT NOT NULL,
        near_non_moss_temp FLOAT NOT NULL,
        near_non_moss_humidity FLOAT NOT NULL,
        wall_temp FLOAT NOT NULL,
        [timestamp] DATETIME NOT NULL
    );
END;
GO

CREATE INDEX IX_moss_data_timestamp ON dbo.moss_data ([timestamp]);
GO

CREATE INDEX IX_non_moss_data_timestamp ON dbo.non_moss_data ([timestamp]);
GO
