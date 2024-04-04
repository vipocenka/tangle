/**
 * @fileoverview
 * Example script to submit jobs/job results to Tangle chain, to test this script
 *  
 * 1. Build the tangle node and start the local network using `./scripts/run-standalone-local.sh --clean`
 *
 * 2. Make sure you have the necessary dependencies installed. You can install them using npm:
 *    ```
 *    npm i
 *    ```
 *
 * 3. Run the script using `cd types && npx ts-node src/playground.ts`
 *
 * 4. The script will connect to the tangle chain, create roles for alice & bob, then submit a job and job result.
 *
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { u8aToHex } from '@polkadot/util';
import { keccak256AsU8a } from "@polkadot/util-crypto";
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

(async () => {
  // Establish connection to the Polkadot node
  const provider = new WsProvider('ws://127.0.0.1:9944');
  const api = await ApiPromise.create({ provider });

  // Wait for the API to be ready
  await api.isReady;

  // Initialize keyring for sr25519 type
  const sr25519Keyring = new Keyring({ type: 'sr25519' });

  // Define Alice and Bob's identities and role seeds
  const ALICE = sr25519Keyring.addFromUri('//Alice');
  const BOB = sr25519Keyring.addFromUri('//Bob');
  
  // Generated by subkey inspect //Alice --scheme Ecdsa
  const ALICE_ROLE_SEED = new Uint8Array(Buffer.from("cb6df9de1efca7a3998a8ead4e02159d5fa99c3e0d4fd6432667390bb4726854", "hex"));
  // Generated by subkey inspect //Bob --scheme Ecdsa
  const BOB_ROLE_SEED = new Uint8Array(Buffer.from("79c3b7fc0b7697b9414cb87adcb37317d1cab32818ae18c0e97ad76395d1fdcf", "hex"));

  // Print role seeds for reference
  console.log('ALICE_ROLE_SEED:', u8aToHex(ALICE_ROLE_SEED))
  console.log('BOB_ROLE_SEED:', u8aToHex(BOB_ROLE_SEED))

  // Generate role key pairs for Alice and Bob
  const ALICE_ROLE = ECPair.fromPrivateKey(Buffer.from(ALICE_ROLE_SEED));
  const BOB_ROLE = ECPair.fromPrivateKey(Buffer.from(BOB_ROLE_SEED));
  console.log('ALICE_ROLE:', u8aToHex(ALICE_ROLE.publicKey));
  console.log('BOB_ROLE:', u8aToHex(BOB_ROLE.publicKey));

  // Obtain the next available job ID from the chain
  const nextJobId = await api.query.jobs.nextJobId();
  const jobId = nextJobId;

  // Transaction to create a profile for Alice
  const creatingProfileTx = api.tx.roles.createProfile({
    Shared: {
      records: [
        {
          role: {
            Tss: {
              DfnsCGGMP21Secp256k1: {},
            },
          },
        },
      ],
      amount: "10000000000000000000",
    },
  }, 10);

  // Sign and send the transaction for creating Alice's profile
  await new Promise(async (resolve) => {
    const unsub = await creatingProfileTx.signAndSend(ALICE, async ({ events = [], status }) => {
      if (status.isInBlock) {
        console.log(
          '[creatingProfileTx] Included at block hash',
          status.asInBlock.toHex()
        );
        console.log('[creatingProfileTx] Events:');
        events.forEach(({ event: { data, method, section } }) => {
          console.log(`\t${section}.${method}:: ${data}`);
        });
        unsub();
        resolve(void 0);
      }
    });
  });

  // Sign and send the transaction for creating Bob's profile
  await new Promise(async (resolve) => {
    const unsub = await creatingProfileTx.signAndSend(BOB, async ({ events = [], status }) => {
      if (status.isInBlock) {
        console.log(
          '[creatingProfileTx] Included at block hash',
          status.asInBlock.toHex()
        );
        console.log('[creatingProfileTx] Events:');
        events.forEach(({ event: { data, method, section } }) => {
          console.log(`\t${section}.${method}:: ${data}`);
        });
        unsub();
        resolve(void 0);
      }
    });
  });

  // Transaction to submit a job
  const submittingJobTx = api.tx.jobs.submitJob({
    expiry: 100,
    ttl: 100,
    jobType: {
      DkgtssPhaseOne: {
        participants: [ALICE.address, BOB.address],
        threshold: 1,
        permittedCaller: null,
        roleType: {
          DfnsCGGMP21Secp256k1: {},
        },
      },
    },
  });

  // Sign and send the transaction for submitting the job
  await new Promise(async (resolve) => {
    const unsub = await submittingJobTx.signAndSend(ALICE, async ({ events = [], status }) => {
      if (status.isInBlock) {
        console.log(
          '[submittingJobTx] Included at block hash',
          status.asInBlock.toHex()
        );
        console.log('[submittingJobTx] Events:');
        events.forEach(({ event: { data, method, section } }) => {
          console.log(`\t${section}.${method}:: ${data}`);
        });
        unsub();
        resolve(void 0);
      }
    });
  });

  // Generate a new ECDSA KeyPair for DKG
  const dkgKeyPair = ECPair.fromPrivateKey(
    Buffer.from("eec7245d6b7d2ccb30380bfbe2a3648cd7a942653f5aa340edcea1f283686619", "hex"),
    { compressed: false }
  );

  // Sign the compressed public key of the ECDSA KeyPair with the role keys of Alice and Bob
  const dkgPublicKey = dkgKeyPair.publicKey;
  const dkgPublicKeyHash = keccak256AsU8a(dkgPublicKey);
  const lowR = false;
  const signature1 = ALICE_ROLE.sign(Buffer.from(dkgPublicKeyHash), lowR);
  const signature2 = BOB_ROLE.sign(Buffer.from(dkgPublicKeyHash), lowR);
  const v = lowR ? 27 : 28;

  // Extend the signatures with recovery id
  const signature1Array = Array.from(signature1);
  const signature2Array = Array.from(signature2);
  signature1Array[64] = v;
  signature2Array[64] = v;
  console.assert(signature1Array.length == 65, 'Signature 1 length is invalid');
  console.assert(signature2Array.length == 65, 'Signature 2 length is invalid');

  // Transaction to submit job result
  const submittingJobResultTx = api.tx.jobs.submitJobResult({
    Tss: {
      DfnsCGGMP21Secp256k1: {},
    },
  }, jobId, {
    DKGPhaseOne: {
      key: u8aToHex(dkgPublicKey),
      signatures: [u8aToHex(Uint8Array.from(signature1Array)), u8aToHex(Uint8Array.from(signature2Array))],
      threshold: 1,
      signatureScheme: {
        Ecdsa: {},
      }
    }
  });

  // Sign and send the transaction for submitting the job result
  await new Promise(async (resolve) => {
    const unsub = await submittingJobResultTx.signAndSend(ALICE, async ({ events = [], status }) => {
      if (status.isInBlock) {
        console.log(
          '[submittingJobResultTx] Included at block hash',
          status.asInBlock.toHex()
        );
        console.log('[submittingJobResultTx] Events:');
        events.forEach(({ event: { data, method, section } }) => {
          console.log(`\t${section}.${method}:: ${data}`);
        });
        unsub();
        resolve(void 0);
      }
    });
  });

  // Exit process after completing all transactions
  process.exit(0);
})();