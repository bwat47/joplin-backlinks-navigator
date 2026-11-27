import { describe, expect, it } from 'vitest';

import type { LinkItem, OutgoingLink } from '../types';
import { buildPanelRows, countLinkedNotes, linkForRow, type PanelRow } from './linkGroups';

const TARGET = { from: 0, to: 1, text: 'x', contextBefore: '', contextAfter: '' };

const backlink = (noteId: string, occurrenceIndex: number): LinkItem => ({
    direction: 'in',
    id: `${noteId}:${occurrenceIndex}`,
    noteId,
    occurrenceIndex,
    title: `Note ${noteId}`,
    notebookName: 'Notebook',
    section: '',
    snippet: `occurrence ${occurrenceIndex}`,
    navigationTarget: TARGET,
});

const outgoing = (noteId: string, anchor: string): OutgoingLink => ({
    direction: 'out',
    id: anchor ? `${noteId}#${anchor}` : noteId,
    noteId,
    anchor,
    title: `Note ${noteId}`,
    notebookName: '',
    section: anchor,
    snippet: '',
    noteOpening: '',
    isTrashed: false,
    ...(anchor ? { navigationTarget: TARGET } : {}),
});

const describeRows = (rows: PanelRow[]): string[] =>
    rows.map((row) => (row.kind === 'group' ? row.id : `${row.nested ? '  ' : ''}${row.id}`));

describe('buildPanelRows', () => {
    const items = [backlink('a', 0), backlink('b', 0), backlink('a', 1)];

    it('nests a note’s links under one header and leaves single links unnested', () => {
        expect(describeRows(buildPanelRows(items, false))).toEqual(['group:a', '  a:0', '  a:1', 'b:0']);
    });

    it('shows one row per note when collapsed', () => {
        expect(describeRows(buildPanelRows(items, true))).toEqual(['group:a', 'b:0']);
    });

    it('leaves a lone outgoing destination unnested, whether whole-note or anchored', () => {
        expect(describeRows(buildPanelRows([outgoing('a', ''), outgoing('b', 'setup')], false))).toEqual([
            'a',
            'b#setup',
        ]);
    });

    it('nests only the anchors of an outgoing note, as the header opens the note itself', () => {
        const rows = buildPanelRows([outgoing('a', ''), outgoing('a', 'setup')], false);

        expect(describeRows(rows)).toEqual(['group:a', '  a#setup']);
        // The header still holds every link, so its count includes the whole-note one.
        expect(rows[0]).toMatchObject({ kind: 'group', items: [outgoing('a', ''), outgoing('a', 'setup')] });
    });

    it('returns no rows for no links', () => {
        expect(buildPanelRows([], false)).toEqual([]);
    });
});

describe('countLinkedNotes', () => {
    it('counts distinct notes rather than rows', () => {
        expect(countLinkedNotes([backlink('a', 0), backlink('a', 1), backlink('b', 0)])).toBe(2);
        expect(countLinkedNotes([])).toBe(0);
    });
});

describe('linkForRow', () => {
    it('opens a single link as itself', () => {
        const [row] = buildPanelRows([backlink('a', 0)], false);

        expect(linkForRow(row!, false)).toEqual(backlink('a', 0));
    });

    it('opens a backlink group’s note without scrolling to an occurrence', () => {
        const [header] = buildPanelRows([backlink('a', 0), backlink('a', 1)], true);

        const link = linkForRow(header!, false);

        expect(link).toMatchObject({ noteId: 'a', direction: 'in' });
        expect(link.navigationTarget).toBeUndefined();
    });

    it('opens an outgoing group’s note without an anchor', () => {
        const [header] = buildPanelRows([outgoing('a', 'setup'), outgoing('a', 'usage')], true);

        const link = linkForRow(header!, false);

        expect(link).toMatchObject({ noteId: 'a', anchor: '' });
        expect(link.navigationTarget).toBeUndefined();
    });

    it('opens a single backlink’s note without scrolling in compact view', () => {
        const [row] = buildPanelRows([backlink('a', 0)], true);

        const link = linkForRow(row!, true);

        expect(link).toMatchObject({ noteId: 'a', direction: 'in' });
        expect(link.navigationTarget).toBeUndefined();
    });

    it('opens a single anchored outgoing link’s note without the anchor in compact view', () => {
        const [row] = buildPanelRows([{ ...outgoing('a', 'setup'), navigationTarget: TARGET }], true);

        const link = linkForRow(row!, true);

        expect(link).toMatchObject({ noteId: 'a', anchor: '' });
        expect(link.navigationTarget).toBeUndefined();
    });
});
