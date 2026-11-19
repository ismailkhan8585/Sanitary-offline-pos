import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShopSettings } from './shop-settings';
import { UsersSettings } from './users-settings';
import { DevicesSettings } from './devices-settings';

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('settings.title')} />
      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop">{t('settings.shop')}</TabsTrigger>
          <TabsTrigger value="users">{t('settings.users')}</TabsTrigger>
          <TabsTrigger value="devices">{t('settings.devices')}</TabsTrigger>
        </TabsList>
        <TabsContent value="shop">
          <ShopSettings />
        </TabsContent>
        <TabsContent value="users">
          <UsersSettings />
        </TabsContent>
        <TabsContent value="devices">
          <DevicesSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
