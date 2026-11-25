"use client";

import { Building2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { PageContainer } from "@/features/shell/workspace-boundary";
import { ProfileForm } from "./profile-form";
import { SystemHealth } from "./system-health";
import { WorkspaceSettings } from "./workspace-settings";

export function SettingsView() {
  const { workspace } = useCurrentWorkspace();
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Manage your profile, workspace and see system status." />
      <Tabs defaultValue="profile" className="gap-4">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="system">System health</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileForm />
        </TabsContent>
        <TabsContent value="workspace">
          {workspace ? (
            <WorkspaceSettings key={workspace.id} workspace={workspace} />
          ) : (
            <EmptyState
              icon={Building2}
              title="No workspace selected"
              description="Create a workspace from the sidebar."
            />
          )}
        </TabsContent>
        <TabsContent value="system">
          <SystemHealth />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
