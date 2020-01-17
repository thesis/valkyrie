// Description:
//  Get some cold hard fake ETH from the keep-test private ETH chain.
//  This is an extraordinarily basic first pass, most things are hardcoded with purpose.
//
//
// Commands:
//   hubot eth-faucet fund <ETH account address> - Transfers 10 ether to the specified address.
//
// Author:
//   sthompson22
//   with referenced hubot code examples from: kb0rg
//

// WARNING: THIS ONLY WORKS FOR KEEP-TEST AT THE MOMENT.  In the future this can be
// extended to pass an environment to the commands provided here.

const Web3 = require("web3")

// ETH host info
const ethHost = "http://eth-tx.test.keep.network"
const ethRpcPort = "8545"
const ethNetworkId = "1101"

// ETH account info
const purse = "0x0f0977c4161a371b5e5ee6a8f43eb798cd1ae1db"

// These are throw away accounts on an internal private testnet, hence the plaintext.
const purseAccountPassword =
  "doughnut_armenian_parallel_firework_backbite_employer_singlet"
const etherToTransfer = "10"

// We override transactionConfirmationBlocks and transactionBlockTimeout because they're
// 25 and 50 blocks respectively at default.  The result of this on small private testnets
// is long wait times for scripts to execute.
const web3_options = {
  defaultBlock: "latest",
  defaultGas: 4712388,
  transactionBlockTimeout: 25,
  transactionConfirmationBlocks: 3,
  transactionPollingTimeout: 480,
}

const web3 = new Web3(
  new Web3.providers.HttpProvider(`${ethHost}:${ethRpcPort}`),
  null,
  web3_options,
)

module.exports = function(robot) {
  robot.respond(/eth-faucet fund (.*)/i, async function(msg) {
    let account = msg.match[1]
    let transferAmount = web3.utils.toWei(etherToTransfer, "ether")

    if (!/^(0x)?[0-9a-f]{40}$/i.test(account)) {
      // check if it has the basic requirements of an address
      // double thanks to the Ethereum folks for figuring this regex out already
      return msg.send(
        "Improperly formatted account address, please try a valid one.",
      )
    }

    try {
      msg.send(`Unlocking purse account: ${purse}`)
      await web3.eth.personal.unlockAccount(purse, purseAccountPassword, 150000)
    } catch (error) {
      robot.logger.error(`ETH account unlock error: ${error.message}`)
      return msg.send(
        "There was an issue unlocking the purse account, ask for an adult!",
      )
    }

    try {
      msg.send(
        `Funding account ${account} with ${etherToTransfer} ETH.  Don't panic, this may take several seconds.`,
      )
      await web3.eth.sendTransaction({
        from: purse,
        to: account,
        value: transferAmount,
      })
      msg.send(`Account ${account} funded!`)
    } catch (error) {
      robot.logger.error(`ETH account funding error: ${error.message}`)
      return msg.send(
        "There was an issue funding the ETH account, ask for an adult!",
      )
    }
  })
}
