-- Add model_workflow column to features and projects for workflow agent model resolution
ALTER TABLE features ADD COLUMN model_workflow TEXT;
ALTER TABLE projects ADD COLUMN model_workflow TEXT;
