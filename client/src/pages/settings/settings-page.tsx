import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShopSettings } from './shop-settings';
import { UsersSettings } from './users-settings';
import { DevicesSettings } from './devices-settings';
import { CounterSettings } from './counter-settings';
import { LicenceSettings } from './licence-settings';

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
          <TabsTrigger value="licence">{t('licence.title')}</TabsTrigger>
          {window.posDesktop && <TabsTrigger value="counter">{t('desktop.thisCounter')}</TabsTrigger>}
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
        <TabsContent value="licence">
          <LicenceSettings />
        </TabsContent>
        {window.posDesktop && (
          <TabsContent value="counter">
            <CounterSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
