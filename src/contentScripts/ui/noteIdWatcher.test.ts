import { Compartment, EditorState, Facet } from '@codemirror/state';
import { createNoteIdWatcher } from './noteIdWatcher';

const noteIdFacet = Facet.define<string, string>({
    combine: (values) => values[0] ?? '',
});

function createState(noteId: string, onNoteChange: (noteId: string) => void) {
    const noteCompartment = new Compartment();
    const state = EditorState.create({
        extensions: [noteCompartment.of(noteIdFacet.of(noteId)), createNoteIdWatcher(noteIdFacet, onNoteChange)],
    });

    return { noteCompartment, state };
}

describe('createNoteIdWatcher', () => {
    it('reports the first observed note switch', () => {
        const changes: string[] = [];
        const { noteCompartment, state } = createState('note-a', (noteId) => changes.push(noteId));

        state.update({
            effects: noteCompartment.reconfigure(noteIdFacet.of('note-b')),
        });

        expect(changes).toEqual(['note-b']);
    });
});
