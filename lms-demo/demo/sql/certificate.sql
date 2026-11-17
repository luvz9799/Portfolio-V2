-- Certificate switch per training: the admin turns it on once every module of the training is uploaded,
-- so nobody gets a "whole training" certificate after finishing only the first few modules.
alter table courses add column if not exists certificate boolean not null default false;
