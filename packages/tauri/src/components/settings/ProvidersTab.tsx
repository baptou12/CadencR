import { CustomModelsSection } from "./CustomModelsSection";
import { ProfilesSection } from "./ProfilesSection";

export function ProvidersTab() {
  return (
    <div className="p-6 space-y-10 overflow-y-auto h-full">
      <ProfilesSection />
      <CustomModelsSection />
    </div>
  );
}
