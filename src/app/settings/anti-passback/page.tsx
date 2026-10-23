import BuildingAccessSettingsPage from "@/components/BuildingAccessSettingsPage";
export default function AntiPassbackPage({ searchParams }: { searchParams: Promise<{ buildingId?: string }> }) {
  return <BuildingAccessSettingsPage field="antiPassbackEnabled" searchParams={searchParams} />;
}
