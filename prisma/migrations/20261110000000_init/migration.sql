-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "externalId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL,
    "marineAvailable" BOOLEAN,
    "lastRequestedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationAlias" (
    "query" TEXT NOT NULL,
    "locationId" INTEGER NOT NULL,

    CONSTRAINT "LocationAlias_pkey" PRIMARY KEY ("query")
);

-- CreateTable
CREATE TABLE "DailyWeather" (
    "locationId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "tempMaxC" DOUBLE PRECISION,
    "tempMinC" DOUBLE PRECISION,
    "apparentTempMaxC" DOUBLE PRECISION,
    "precipitationMm" DOUBLE PRECISION,
    "precipitationProbability" DOUBLE PRECISION,
    "snowfallCm" DOUBLE PRECISION,
    "snowDepthCm" DOUBLE PRECISION,
    "windMaxKmh" DOUBLE PRECISION,
    "gustMaxKmh" DOUBLE PRECISION,
    "weatherCode" INTEGER,
    "sunshineSeconds" DOUBLE PRECISION,
    "uvIndexMax" DOUBLE PRECISION,
    "cloudCoverMeanPct" DOUBLE PRECISION,
    "waveHeightMaxM" DOUBLE PRECISION,
    "wavePeriodMaxS" DOUBLE PRECISION,

    CONSTRAINT "DailyWeather_pkey" PRIMARY KEY ("locationId","date")
);

-- CreateTable
CREATE TABLE "FetchState" (
    "locationId" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMPTZ(3),

    CONSTRAINT "FetchState_pkey" PRIMARY KEY ("locationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_externalId_key" ON "Location"("externalId");

-- CreateIndex
CREATE INDEX "LocationAlias_locationId_idx" ON "LocationAlias"("locationId");

-- AddForeignKey
ALTER TABLE "LocationAlias" ADD CONSTRAINT "LocationAlias_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyWeather" ADD CONSTRAINT "DailyWeather_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchState" ADD CONSTRAINT "FetchState_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

