import { DbService } from '../src/services/DbService';

async function test() {
    console.log('Initializing Database...');
    DbService.initialize();

    const prompt = "Test prompt for grouping " + Date.now();
    
    console.log('Inserting first prompt...');
    const id1 = DbService.insertPromptHistory({
        serverName: 'test-server',
        modelName: 'test-model',
        prompt: prompt
    });

    console.log('Assigning groupId for first prompt (should do nothing)...');
    await DbService.assignGroupIdByPrompt(id1, prompt);
    
    const record1 = DbService.getDb().prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id1) as any;
    console.log('Record 1 groupId:', record1.groupId);

    console.log('Inserting second prompt (identical)...');
    const id2 = DbService.insertPromptHistory({
        serverName: 'test-server',
        modelName: 'test-model',
        prompt: prompt
    });

    console.log('Assigning groupId for second prompt (should link both)...');
    await DbService.assignGroupIdByPrompt(id2, prompt);

    const record1_updated = DbService.getDb().prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id1) as any;
    const record2 = DbService.getDb().prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id2) as any;

    console.log('Record 1 updated groupId:', record1_updated.groupId);
    console.log('Record 2 groupId:', record2.groupId);

    if (record1_updated.groupId && record1_updated.groupId === record2.groupId) {
        console.log('SUCCESS: Both records have the same groupId!');
    } else {
        console.log('FAILURE: GroupIds do not match or are missing.');
        process.exit(1);
    }

    console.log('Inserting third prompt (identical)...');
    const id3 = DbService.insertPromptHistory({
        serverName: 'test-server',
        modelName: 'test-model',
        prompt: prompt
    });

    console.log('Assigning groupId for third prompt (should reuse existing)...');
    await DbService.assignGroupIdByPrompt(id3, prompt);

    const record3 = DbService.getDb().prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id3) as any;
    console.log('Record 3 groupId:', record3.groupId);

    if (record3.groupId === record1_updated.groupId) {
        console.log('SUCCESS: Third record reused the existing groupId!');
    } else {
        console.log('FAILURE: Third record did not reuse the groupId.');
        process.exit(1);
    }
    
    process.exit(0);
}

test().catch(err => {
    console.error(err);
    process.exit(1);
});
