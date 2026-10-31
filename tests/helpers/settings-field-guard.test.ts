import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifySettingFieldUsage } from './settings-field-guard';

describe('classifySettingFieldUsage', () => {
  it('allows String(settings.field)', () => {
    assert.equal(classifySettingFieldUsage('minDays.value = String(settings.minDaysBetweenOrders);', 'minDaysBetweenOrders'), 'presentational');
  });
  it('allows booleanLabel(settings.field)', () => {
    assert.equal(classifySettingFieldUsage('setText(ELEMENT_IDS.settingsFriday, booleanLabel(settings.allowFridayOrders));', 'allowFridayOrders'), 'presentational');
  });
  it('allows setText(..., settings.field)', () => {
    assert.equal(classifySettingFieldUsage('setText(ELEMENT_IDS.settingsAssistant, settings.assistantId);', 'assistantId'), 'presentational');
  });
  it('allows .value = settings.field', () => {
    assert.equal(classifySettingFieldUsage('startTime.value = settings.startTime;', 'startTime'), 'presentational');
  });
  it('allows .value = String(settings.field)', () => {
    assert.equal(classifySettingFieldUsage('minDays.value = String(settings.minDaysBetweenOrders);', 'minDaysBetweenOrders'), 'presentational');
  });
  it('allows setHidden(..., settings.field)', () => {
    assert.equal(classifySettingFieldUsage('setHidden(ELEMENT_IDS.settingsNotConfigured, settings.configured);', 'configured'), 'presentational');
  });
  it('rejects assigning to another variable', () => {
    assert.equal(classifySettingFieldUsage('const t = settings.startTime;', 'startTime'), 'unsafe');
  });
  it('rejects returning a setting value', () => {
    assert.equal(classifySettingFieldUsage('return settings.startTime;', 'startTime'), 'unsafe');
  });
  it('rejects throwing a setting value', () => {
    assert.equal(classifySettingFieldUsage('throw settings.startTime;', 'startTime'), 'unsafe');
  });
  it('rejects comparison with ==', () => {
    assert.equal(classifySettingFieldUsage('if (settings.minDaysBetweenOrders == 5) {}', 'minDaysBetweenOrders'), 'unsafe');
  });
  it('rejects comparison with >', () => {
    assert.equal(classifySettingFieldUsage('if (settings.minDaysBetweenOrders > 5) {}', 'minDaysBetweenOrders'), 'unsafe');
  });
  it('rejects if condition', () => {
    assert.equal(classifySettingFieldUsage('if (settings.allowFridayOrders) {}', 'allowFridayOrders'), 'unsafe');
  });
  it('rejects assigning to setting field', () => {
    assert.equal(classifySettingFieldUsage('settings.minDaysBetweenOrders = 5;', 'minDaysBetweenOrders'), 'unsafe');
  });
  it('rejects assigning to setting field with +=', () => {
    assert.equal(classifySettingFieldUsage('settings.minDaysBetweenOrders += 1;', 'minDaysBetweenOrders'), 'unsafe');
  });
  it('rejects plain variable assignment', () => {
    assert.equal(classifySettingFieldUsage('t = settings.startTime;', 'startTime'), 'unsafe');
  });
  it('rejects calculation', () => {
    assert.equal(classifySettingFieldUsage('const x = settings.minDaysBetweenOrders + 1;', 'minDaysBetweenOrders'), 'unsafe');
  });
});
