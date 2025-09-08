const { MongoClient } = require('mongodb');
const readline = require('readline');

class MongoDBReplicator {
     constructor() {
          this.sourceClient = null;
          this.targetClient = null;
          this.sourceDb = null;
          this.targetDb = null;
     }

     async connect(sourceUrl, targetUrl) {
          try {
               console.log('🔌 Connecting to source database...');
               this.sourceClient = new MongoClient(sourceUrl);
               await this.sourceClient.connect();

               console.log('🔌 Connecting to target database...');
               this.targetClient = new MongoClient(targetUrl);
               await this.targetClient.connect();

               // Extract database names from URLs
               const sourceDbName = this.extractDbName1(sourceUrl);
               const targetDbName = this.extractDbName(targetUrl);

               this.sourceDb = this.sourceClient.db(sourceDbName);
               this.targetDb = this.targetClient.db(targetDbName);

               console.log('✅ Successfully connected to both databases');
               console.log(`Source: ${sourceDbName}`);
               console.log(`Target: ${targetDbName}`);

               return true;
          } catch (error) {
               console.error('❌ Connection failed:', error.message);
               return false;
          }
     }

     extractDbName1(url) {
          const match = url.match(/\/([^/?]+)(\?|$)/); 
          return match ? match[1] : 'Copy-of-Your-DB';
     }

     extractDbName(url) {
          const match = url.match(/\/([^/?]+)(\?|$)/);
          const baseName = match ? match[1] : 'Copy-of-Your-DB';
          const now = new Date();
          const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

          return `${timestamp}_${baseName}`;
     }

     async getCollections() {
          try {
               const collections = await this.sourceDb.listCollections().toArray();
               return collections.map(col => col.name);
          } catch (error) {
               console.error('❌ Failed to get collections:', error.message);
               return [];
          }
     }

     async copyCollection(collectionName) {
          try {
               console.log(`Copying collection: ${collectionName}`);

               const sourceCollection = this.sourceDb.collection(collectionName);
               const targetCollection = this.targetDb.collection(collectionName);
               const totalDocs = await sourceCollection.countDocuments();
               console.log(`  📊 Total documents: ${totalDocs}`);

               if (totalDocs === 0) {
                    console.log(`  ✅ Collection ${collectionName} is empty - skipping`);
                    return { success: true, copied: 0, errors: 0 };
               }
               const batchSize = 1000;
               let copied = 0;
               let errors = 0;

               const cursor = sourceCollection.find({});

               while (await cursor.hasNext()) {
                    const batch = [];
                    for (let i = 0; i < batchSize && await cursor.hasNext(); i++) {
                         const doc = await cursor.next();
                         batch.push(doc);
                    }

                    if (batch.length > 0) {
                         try {
                              await targetCollection.insertMany(batch, { ordered: false });
                              copied += batch.length;

                              // Progress update
                              const progress = ((copied / totalDocs) * 100).toFixed(1);
                              console.log(`  📈 Progress: ${copied}/${totalDocs} (${progress}%)`);
                         } catch (batchError) {
                              console.error(`  ⚠️ Batch insert error:`, batchError.message);
                              errors += batch.length;
                         }
                    }
               }

               console.log(`  ✅ Collection ${collectionName} completed: ${copied} copied, ${errors} errors`);
               return { success: true, copied, errors };

          } catch (error) {
               console.error(`❌ Failed to copy collection ${collectionName}:`, error.message);
               return { success: false, copied: 0, errors: 0 };
          }
     }

     async copyIndexes(collectionName) {
          try {
               const sourceCollection = this.sourceDb.collection(collectionName);
               const targetCollection = this.targetDb.collection(collectionName);

               const indexes = await sourceCollection.indexes();

               for (const index of indexes) {
                    // Skip the default _id index
                    if (index.name === '_id_') continue;

                    try {
                         const indexSpec = { ...index.key };
                         const options = { ...index };
                         delete options.key;
                         delete options.v;
                         delete options.ns;

                         await targetCollection.createIndex(indexSpec, options);
                         console.log(`  🔍 Index copied: ${index.name}`);
                    } catch (indexError) {
                         console.error(`  ⚠️ Failed to copy index ${index.name}:`, indexError.message);
                    }
               }
          } catch (error) {
               console.error(`⚠️ Failed to copy indexes for ${collectionName}:`, error.message);
          }
     }

     async replicate(copyIndexes = true) {
          try {
               console.log('🚀 Starting database replication...');

               const collections = await this.getCollections();

               if (collections.length === 0) {
                    console.log('📭 No collections found in source database');
                    return;
               }

               console.log(`📚 Found ${collections.length} collections to copy`);

               let totalCopied = 0;
               let totalErrors = 0;

               for (const collectionName of collections) {
                    const result = await this.copyCollection(collectionName);

                    if (result.success) {
                         totalCopied += result.copied;
                         totalErrors += result.errors;

                         // Copy indexes if requested
                         if (copyIndexes) {
                              await this.copyIndexes(collectionName);
                         }
                    }
               }

               console.log('\n🎉 Replication completed!');
               console.log(`📊 Summary:`);
               console.log(`  Collections: ${collections.length}`);
               console.log(`  Documents copied: ${totalCopied}`);
               console.log(`  Errors: ${totalErrors}`);

          } catch (error) {
               console.error('❌ Replication failed:', error.message);
          }
     }

     async close() {
          try {
               if (this.sourceClient) {
                    await this.sourceClient.close();
               }
               if (this.targetClient) {
                    await this.targetClient.close();
               }
               console.log('🔌 Database connections closed');
          } catch (error) {
               console.error('⚠️ Error closing connections:', error.message);
          }
     }
}

// Interactive CLI function
async function promptForUrls() {
     const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
     });

     const question = (prompt) => {
          return new Promise((resolve) => {
               rl.question(prompt, resolve);
          });
     };

     console.log('🔄 MongoDB Replication Tool');
     console.log('===============================\n');

     const sourceUrl = await question('Enter source MongoDB URL: ');
     const targetUrl = await question('Enter target MongoDB URL: ');
     const copyIndexesAnswer = await question('Copy indexes too? (y/n) [y]: ');

     rl.close();

     const copyIndexes = copyIndexesAnswer.toLowerCase() !== 'n';

     return { sourceUrl, targetUrl, copyIndexes };
}

// Main execution function
async function main() {
     let sourceUrl, targetUrl, copyIndexes;

     // Check if URLs provided as command line arguments
     if (process.argv.length >= 4) {
          sourceUrl = process.argv[2];
          targetUrl = process.argv[3];
          copyIndexes = process.argv[4] !== '--no-indexes';

          console.log('📋 Using command line arguments:');
          console.log(`Source: ${sourceUrl}`);
          console.log(`Target: ${targetUrl}`);
          console.log(`Copy indexes: ${copyIndexes}`);
     } else {
          // Interactive mode
          const input = await promptForUrls();
          sourceUrl = input.sourceUrl;
          targetUrl = input.targetUrl;
          copyIndexes = input.copyIndexes;
     }

     // Validate URLs
     if (!sourceUrl || !targetUrl) {
          console.error('❌ Both source and target URLs are required');
          process.exit(1);
     }

     const replicator = new MongoDBReplicator();

     try {
          const connected = await replicator.connect(sourceUrl, targetUrl);

          if (!connected) {
               process.exit(1);
          }

          await replicator.replicate(copyIndexes);

     } catch (error) {
          console.error('❌ Unexpected error:', error.message);
     } finally {
          await replicator.close();
     }
}

// Export for use as module
module.exports = MongoDBReplicator;

// Run if called directly
if (require.main === module) {
     main().catch(console.error);
}
