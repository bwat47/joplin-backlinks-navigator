import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export interface ReferenceHighlightRange {
    from: number;
    to: number;
}

export const setReferenceHighlightEffect = StateEffect.define<ReferenceHighlightRange>();

const referenceHighlightMark = Decoration.mark({
    class: 'backlinks-navigator-reference-highlight',
});

export const referenceHighlightField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },

    update(highlights, transaction) {
        let nextHighlights = highlights.map(transaction.changes);
        let handledByEffect = false;

        for (const effect of transaction.effects) {
            if (effect.is(setReferenceHighlightEffect)) {
                const { from, to } = effect.value;
                nextHighlights = from < to ? Decoration.set([referenceHighlightMark.range(from, to)]) : Decoration.none;
                handledByEffect = true;
            }
        }

        if (
            !handledByEffect &&
            transaction.selection &&
            !transaction.startState.selection.eq(transaction.state.selection)
        ) {
            return Decoration.none;
        }

        return nextHighlights;
    },

    provide: (field) => EditorView.decorations.from(field),
});

const referenceHighlightTheme = EditorView.baseTheme({
    '.backlinks-navigator-reference-highlight': {
        backgroundColor: 'rgba(255, 214, 80, 0.38)',
        borderRadius: '2px',
        boxShadow: '0 0 0 1px rgba(180, 130, 0, 0.35)',
    },
});

export const referenceHighlightExtension = [referenceHighlightField, referenceHighlightTheme];
