export interface RuntimeModelPickerModel {
  id: string;
  label: string;
  description?: string;
}

export interface RuntimeModelPickerProvider {
  id: string;
  label: string;
  disabled: boolean;
  status?: "available" | "unavailable" | "coming_soon";
  statusMessage?: string;
  models: RuntimeModelPickerModel[];
}

export type RuntimeModelSelectionResolver = (
  providerId: string,
  modelId: string,
  models: readonly RuntimeModelPickerModel[],
) => string;
