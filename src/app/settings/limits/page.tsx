import BuildingAccessSettingsPage from "@/components/BuildingAccessSettingsPage";
export default function LimitsPage({ searchParams }: { searchParams: Promise<{ buildingId?: string }> }) {
  return <BuildingAccessSettingsPage field="parkingLimitsEnabled" searchParams={searchParams} />;
}
