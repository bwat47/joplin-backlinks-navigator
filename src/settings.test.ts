jest.mock('api', () => ({
    __esModule: true,
    default: {},
}));

import { normalizeCtrlClickBehavior, normalizeCtrlEnterBehavior } from './settings';

describe('settings normalization', () => {
    it('accepts supported Ctrl-click backlink behaviors', () => {
        expect(normalizeCtrlClickBehavior('newWindow')).toEqual({ value: 'newWindow', changed: false });
        expect(normalizeCtrlClickBehavior('newTab')).toEqual({ value: 'newTab', changed: false });
    });

    it('falls back to new window for invalid Ctrl-click backlink behaviors', () => {
        expect(normalizeCtrlClickBehavior('current')).toEqual({ value: 'newWindow', changed: true });
        expect(normalizeCtrlClickBehavior(undefined)).toEqual({ value: 'newWindow', changed: true });
    });

    it('accepts supported Ctrl-Enter backlink behaviors', () => {
        expect(normalizeCtrlEnterBehavior('newWindow')).toEqual({ value: 'newWindow', changed: false });
        expect(normalizeCtrlEnterBehavior('newTab')).toEqual({ value: 'newTab', changed: false });
    });

    it('falls back to new window for invalid Ctrl-Enter backlink behaviors', () => {
        expect(normalizeCtrlEnterBehavior('current')).toEqual({ value: 'newWindow', changed: true });
        expect(normalizeCtrlEnterBehavior(undefined)).toEqual({ value: 'newWindow', changed: true });
    });
});
