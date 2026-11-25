-- App-authored migration dated far in the future (clock skew)
CREATE TABLE "fixture_app_later" ("id" UUID NOT NULL, CONSTRAINT "fixture_app_later_pkey" PRIMARY KEY ("id"));
