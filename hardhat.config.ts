import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import registerTasks from './scripts/getPrices'

registerTasks()

const config: HardhatUserConfig = {
  solidity: "0.8.18",
};

export default config;