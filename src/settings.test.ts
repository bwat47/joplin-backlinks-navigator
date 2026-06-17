jest.mock('api', () => ({
    __esModule: true,
    default: {},
}));

import { normalizeCtrlClickBehavior, normalizeCtrlEnterBehavior, normalizeIgnoredBacklinkNoteIds } from './settings';

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

    it('parses comma-separated ignored backlink note ids', () => {
        expect(
            normalizeIgnoredBacklinkNoteIds('bb12adaa3c704ff3bf09c0d7f7ad0c38, 14270a1ea65546319c1ed3db0e362c37')
        ).toEqual({
            value: ['bb12adaa3c704ff3bf09c0d7f7ad0c38', '14270a1ea65546319c1ed3db0e362c37'],
            changed: false,
        });
    });

    it('drops invalid and duplicate ignored backlink note ids', () => {
        expect(
            normalizeIgnoredBacklinkNoteIds(
                'BB12ADAA3C704FF3BF09C0D7F7AD0C38, invalid, bb12adaa3c704ff3bf09c0d7f7ad0c38,'
            )
        ).toEqual({
            value: ['bb12adaa3c704ff3bf09c0d7f7ad0c38'],
            changed: true,
        });
    });

    it('treats an empty ignored backlink note id setting as valid', () => {
        expect(normalizeIgnoredBacklinkNoteIds('  ')).toEqual({ value: [], changed: false });
    });
});
