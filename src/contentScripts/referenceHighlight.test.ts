import { EditorSelection, EditorState } from '@codemirror/state';
import {
    referenceHighlightField,
    referenceHighlightExtension,
    setReferenceHighlightEffect,
} from './referenceHighlight';

function createState(doc = 'Before [Target](:/note-id) after'): EditorState {
    return EditorState.create({
        doc,
        extensions: [referenceHighlightExtension],
    });
}

function highlightRanges(state: EditorState): { from: number; to: number }[] {
    const ranges: { from: number; to: number }[] = [];
    state.field(referenceHighlightField).between(0, state.doc.length, (from, to) => {
        ranges.push({ from, to });
    });
    return ranges;
}

describe('referenceHighlightExtension', () => {
    it('adds a highlight range from the set effect', () => {
        const state = createState();
        const nextState = state.update({
            effects: setReferenceHighlightEffect.of({ from: 7, to: 26 }),
        }).state;

        expect(highlightRanges(nextState)).toEqual([{ from: 7, to: 26 }]);
    });

    it('clears the highlight when the selection moves', () => {
        const highlighted = createState().update({
            effects: setReferenceHighlightEffect.of({ from: 7, to: 26 }),
        }).state;
        const moved = highlighted.update({
            selection: EditorSelection.cursor(3),
        }).state;

        expect(highlightRanges(moved)).toEqual([]);
    });

    it('keeps the highlight when the same selection is reasserted', () => {
        const highlighted = createState().update({
            selection: EditorSelection.cursor(7),
            effects: setReferenceHighlightEffect.of({ from: 7, to: 26 }),
        }).state;
        const sameSelection = highlighted.update({
            selection: EditorSelection.cursor(7),
        }).state;

        expect(highlightRanges(sameSelection)).toEqual([{ from: 7, to: 26 }]);
    });
});
