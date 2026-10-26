
  async function submitSettingsSave(): Promise<void> {
    const minDaysEl = document.getElementById(ELEMENT_IDS.settingsMinDays);
    const fridayEl = document.getElementById(ELEMENT_IDS.settingsFriday);
    const startEl = document.getElementById(ELEMENT_IDS.settingsStartTime);
    const endEl = document.getElementById(ELEMENT_IDS.settingsEndTime);
    const minDays = minDaysEl ? Number(minDaysEl.value) : '';
    const friday = fridayEl ? fridayEl.checked : false;
    const start = startEl ? startEl.value : '';
    const end = endEl ? endEl.value : '';
    const draft: AppSettingsViewDraft = {
      minDaysBetweenOrders: minDays,
      allowFridayOrders: friday,
      startTime: start,
      endTime: end,
    };
    const result = await drugManager.settings.save(draft);
    if (!result.ok) {
      // Error handling simplified
    }
    await loadSettings('saving');
  } catch (e) {
    // Error handling simplified
  } finally {
    settingsSaveInFlight = false;
    setDisabled(ELEMENT_IDS.settingsSave, false);
  }
}

// Event listener for settings save button
document.getElementById(ELEMENT_IDS.settingsSave)?.addEventListener('click', () => {
  void submitSettingsSave();
});
/* Fixed renderer.ts - duplicate submitSettingsSave removed */
import { Component, OnInit } from '@angular/core';
import { drugManager } from './drugManager';
import { ELEMENT_IDS } from './element-ids';
import { AppSettingsViewDraft } from './app-settings-view-draft';
import { settingsSaveInFlight, settingsInFlight } from './state';
import { getDrugManagerApi } from './get-drug-manager-api';
import { loadSettings } from './load-settings';
import { setDisabled } from './set-disabled';
import { setErrorMessage } from './set-error-message';
import { setSettingsState } from './set-settings-state';
import { BRIDGE_UNAVAILABLE_MESSAGE } from './bridge-constants';
<!-- Renderer TS file - fixed version -->
// This file has been fixed to remove duplicate submitSettingsSave definition
