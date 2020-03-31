// Description:
//  Create an account, and/ or get some cold hard fake ETH from the Ropsten ETH testnet.
//
// Configuration:
//   CONTRACT_OWNER_ETH_ACCOUNT_PRIVATE_KEY - Private key for the keep-test owner account on Ropsten.
//
// Commands:
//   hubot eth-account fund <ETH account address> - Transfers 5 ether to the specified address.
//   hubot eth-account create <your-secret-passphrase> - Creates a new account on the Ropsten ETH testnet and returns a keyfile JSON (including private key! This is not for use in production!). This command funds the new account as well.
//
// Author:
//   sthompson22
//   kb0rg
//

const Web3 = require("web3")

const HDWalletProvider = require("@truffle/hdwallet-provider")

// ETH host info
const ethUrl = "https://ropsten.infura.io/v3/59fb36a36fa4474b890c13dd30038be5"
const ethNetworkId = "3"

// Contract owner info
const contractOwnerAddress = "0x923C5Dbf353e99394A21Aa7B67F3327Ca111C67D"
const contractOwnerProvider = new HDWalletProvider(
  process.env.CONTRACT_OWNER_ETH_ACCOUNT_PRIVATE_KEY,
  ethUrl,
)
const authorizer = contractOwnerAddress

// We override transactionConfirmationBlocks and transactionBlockTimeout because
// they're 25 and 50 blocks respectively at default.  The result of this on
// small private testnets is long wait times for scripts to execute.
const web3_options = {
  defaultBlock: "latest",
  defaultGas: 4712388,
  transactionBlockTimeout: 25,
  transactionConfirmationBlocks: 3,
  transactionPollingTimeout: 480,
}

// We use the contractOwner for all web3 calls except those where the operator
// address is required.
const web3 = new Web3(contractOwnerProvider, null, web3_options)

const etherToTransfer = "5"

const { TextMessage } = require("hubot")

function postMessageCallback(robot, msg, accountAddress, filename) {
  return function(err, res, body) {
    const messageEnvelope = {
      user: msg.message.user,
      room: msg.message.user.room,
      metadata: { thread_id: msg.message.metadata.thread_id },
    }
    if (err) {
      robot.send(
        messageEnvelope,
        `Something went wrong trying to post the keyfile for ${accountAddress}`,
      )
      robot.logger.error(`POST returned: ${require("util").inspect(err)}`)
    } else if (res) {
      let postReplyMessage = `Download the above keyfile: \`${filename}\` for account: ${accountAddress}.`
      robot.send(messageEnvelope, postReplyMessage)
      let messageToRobot = new TextMessage(
        msg.message.user,
        `${robot.alias}eth-account fund ${accountAddress}`,
      )
      messageToRobot.metadata = msg.message.metadata
      robot.adapter.receive(messageToRobot)
    } else {
      robot.logger.info(
        `Something happened after posting keyfile for ${accountAddress}. FLowdock API response: %o`,
        body,
      )
    }
  }
}

module.exports = function(robot) {
  robot.respond(/eth-account fund (\S+)(?: *)(\d+\.?\d*)?/i, function(msg) {
    let account = msg.match[1]
    let amount = msg.match[2] || ""
    let transferAmount = web3.utils.toWei(amount || etherToTransfer, "ether")

    if (!/^(0x)?[0-9a-f]{40}$/i.test(account)) {
      // check if it has the basic requirements of an address
      // double thanks to the Ethereum folks for figuring this regex out already
      return msg.send(
        "Improperly formatted account address, please try a valid one.",
      )
    }

    web3.eth
      .sendTransaction({
        from: contractOwnerAddress, // contract owner:
        to: account,
        value: transferAmount,
      })
      .then(receipt => {
        robot.logger.info(
          `Funded account ${account}, txHash: ${receipt.transactionHash}`,
        )
        msg.send(`Account ${account} funded!`)
      })
      .catch(error => {
        robot.logger.error(`ETH account funding error: ${error.message}`)
        return msg.send(
          "There was an issue funding the ETH account, ask for an adult!",
        )
      })
  })

  robot.respond(/eth-account create(?: )?(.*)/i, function(msg) {
    try {
      let passphrase = msg.match[1].trim()
      if (!passphrase) {
        return msg.send(
          "You must provide a passphrase with this command.\nI recommend using [a bip39 mnemonic phrase](https://en.bitcoinwiki.org/wiki/Mnemonic_phrase).\nPlease try again with a passphrase If you're concerned about the privacy of this account, you may want to call this command in a DM with me.",
        )
      }
      msg.send(
        `Creating account on the Ropsten test network.\nDon't forget to save your passphrase somewhere secure!`,
      )
      let newAccount = web3.eth.accounts.create()
      let keyfileJSON = JSON.stringify(
        web3.eth.accounts.encrypt(newAccount.privateKey, passphrase),
      )

      let content = Buffer.from(keyfileJSON, "binary").toString("base64")
      let filename = `${newAccount.address.slice(0, 7)}-keyfile.json`
      let postParams = {
        event: "file",
        thread_id: msg.message.metadata.thread_id,
        flow: msg.message.user.room,
        content: {
          data: content,
          content_type: "application/json",
          file_name: filename,
        },
      }
      let extraHeader = { "X-flowdock-wait-for-message": true }
      robot.adapter.bot.post(
        "/messages",
        postParams,
        extraHeader,
        postMessageCallback(robot, msg, newAccount.address, filename),
      )
    } catch (error) {
      robot.logger.error(`Error creating account: ${error.message}`)
      return msg.send(
        "There was an issue creating a new Ropsten account, ask for an adult!",
      )
    }
  })
}
