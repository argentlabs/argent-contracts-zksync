/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type { Provider, TransactionRequest } from "@ethersproject/providers";
import { Contract, ContractFactory, Overrides, Signer, utils } from "ethers";
import type { PromiseOrValue } from "../../../common";
import type {
  UserWhitelistPaymaster,
  UserWhitelistPaymasterInterface,
} from "../../../contracts/paymasters/UserWhitelistPaymaster";

const _abi = [
  {
    inputs: [
      {
        internalType: "address[]",
        name: "_whitelist",
        type: "address[]",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_newOwner",
        type: "address",
      },
    ],
    name: "OwnerChanged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_address",
        type: "address",
      },
    ],
    name: "Unwhitelisted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_address",
        type: "address",
      },
    ],
    name: "Whitelisted",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_newOwner",
        type: "address",
      },
    ],
    name: "changeOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "_context",
        type: "bytes",
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "ergsLimit",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "ergsPerPubdataByteLimit",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "maxFeePerErg",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerErg",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256",
          },
          {
            internalType: "uint256[6]",
            name: "reserved",
            type: "uint256[6]",
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes",
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes",
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]",
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes",
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes",
          },
        ],
        internalType: "struct Transaction",
        name: "_transaction",
        type: "tuple",
      },
      {
        internalType: "bytes32",
        name: "_transactionHash",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_suggestedSignedHash",
        type: "bytes32",
      },
      {
        internalType: "enum ExecutionResult",
        name: "_transactionResult",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "_maxRefundedErgs",
        type: "uint256",
      },
    ],
    name: "postOp",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_recipient",
        type: "address",
      },
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
    ],
    name: "recoverToken",
    outputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_address",
        type: "address",
      },
    ],
    name: "unwhitelistUser",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "ergsLimit",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "ergsPerPubdataByteLimit",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "maxFeePerErg",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerErg",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256",
          },
          {
            internalType: "uint256[6]",
            name: "reserved",
            type: "uint256[6]",
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes",
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes",
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]",
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes",
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes",
          },
        ],
        internalType: "struct Transaction",
        name: "_transaction",
        type: "tuple",
      },
    ],
    name: "validateAndPayForPaymasterTransaction",
    outputs: [
      {
        internalType: "bytes",
        name: "_context",
        type: "bytes",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "whitelist",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_address",
        type: "address",
      },
    ],
    name: "whitelistUser",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    stateMutability: "payable",
    type: "receive",
  },
];

const _bytecode =
  "0x000400000000000200000000030100190000006003300270000001960030019d000001960330019700030000003103550002000000010355000000000131034f0000006001100270000101960010019d00000001012001900000000d0000c13d065101ab0000040f065100bd0000040f0000000002120019000000000312004b0000001c0000a13d000000000412004900000000030104330000003f0440008c000000190000a13d00000020041000390000000004040433000000000043041e0000001a0000013d000000000003041e00000040011000390000000f0000013d000000000001042d0002000000000002000200000006001d000100000005001d000000c001100210000001970110019700000040033002100000019803300197000000000113019f00000060034002100000019903300197000000000131019f0651063e0000040f000000010800002900000002040000290000001f0340018f0000000504400270000000000540004c000000380000613d000000000500001900000005065002100000000007680019000000000661034f000000000606043b00000000006704350000000105500039000000000645004b000000300000413d000000000530004c000000470000613d0000000504400210000000000541034f00000000044800190000000303300210000000000604043300000000063601cf000000000636022f000000000505043b0000010003300089000000000535022f00000000033501cf000000000363019f000000000034043500030000000103550000006001100270000101960010019d000000010120018f0000000200000005000000000001042d0002000000000002000200000005001d000100000004001d00000040033002100000019803300197000000c0011002100000019701100197000000000131019f0000019a011001c7065106430000040f000000010800002900000002040000290000001f0340018f0000000504400270000000000540004c000000660000613d000000000500001900000005065002100000000007680019000000000661034f000000000606043b00000000006704350000000105500039000000000645004b0000005e0000413d000000000530004c000000750000613d0000000504400210000000000541034f00000000044800190000000303300210000000000604043300000000063601cf000000000636022f000000000505043b0000010003300089000000000535022f00000000033501cf000000000363019f000000000034043500030000000103550000006001100270000101960010019d000000010120018f0000000200000005000000000001042d0000006002200210000001990220019700000040011002100000019801100197000000000121019f0000019b011001c70000801002000039065106430000040f0000000102200190000000870000613d000000000101043b000000000001042d000000000201001900000060022002700000001f0320018f0000019c022001970000000504200270000000000540004c000000960000613d00000000050000190000000506500210000000000761034f000000000707043b00000000007604350000000105500039000000000645004b0000008f0000413d000000000530004c000000a40000613d00000003033002100000000504400210000000000504043300000000053501cf000000000535022f000000000141034f000000000101043b0000010003300089000000000131022f00000000013101cf000000000151019f00000000001404350000000001000019065100b70000040f00000000020100190000019d01000041065106430000040f0000000102200190000000ad0000613d000000000101043b000000000001042d00000000010000190000000002000019065100b70000040f000000400110021000000198011001970000000001310019000000600220021000000199022001970000000001210019000006520001042e0000004001100210000001980110019700000060022002100000019902200197000000000112019f0000065300010430000a00000000000200000080010000390000004002000039000900000002001d00000000001204350000000001000416000000000110004c000001200000c13d0000000001000031000a00000001001d0651057e0000040f0000000a080000290000001f0280018f00000002030003670000000504800270000000000540004c000000d70000613d000000000500001900000005065002100000000007610019000000000663034f000000000606043b00000000006704350000000105500039000000000645004b000000cf0000413d000000000520004c000000e60000613d0000000504400210000000000343034f00000000044100190000000302200210000000000504043300000000052501cf000000000525022f000000000303043b0000010002200089000000000323022f00000000022301cf000000000252019f00000000002404350000019e02000041000000200380008c000000000300001900000000030240190000019e04800197000000000540004c000000000200a0190000019e0440009c000000000203c019000000000220004c000001200000c13d00000000020104330000019c0320009c000001200000213d000000000781001900000000061200190000001f016000390000019e02000041000000000371004b000000000300001900000000030280190000019e011001970000019e04700197000000000541004b0000000002008019000000000141013f0000019e0110009c00000000010300190000000001026019000000000110004c000001200000c13d00000000020604330000019f0120009c000001100000413d000001a901000041000000000010043500000041010000390000000402000039000000000012043500000024020000390000000001000019065100b70000040f00000005012002100000002001100039000700000001001d000a00000006001d000800000007001d000600000002001d0651057e0000040f0000000a05000029000400000001001d00000006020000290000000000210435000000070100002900000000015100190000000802000029000000000221004b000001230000a13d00000000010000190000000002000019065100b70000040f00000004020000290000002002200039000300000002001d0000002005500039000000000315004b0000012f0000813d0000000003050433000001a20430009c000001200000213d00000000003204350000002002200039000001260000013d00000000010000190651064f0000040f000001a0011001970000000002000411000200000002001d000000000121019f00000000020000190651064d0000040f0000000101000039000700000001001d0000002001000039000800000001001d000001000100008a000100000001001d000000000200001900000004010000290000000001010433000000000112004b000001780000813d000600000002001d0000000501200210000000030200002900000000011200190000000001010433000001a201100197000a00000001001d00000000010000190651064f0000040f000001a2011001970000000202000029000000000112004b000001800000c13d0000000a01000029000000000110004c000000090200002900000008040000290000018f0000613d0000000a0100002900000000001004350000000701000029000000000014043500000000010000190651007b0000040f0651064f0000040f000000ff011001900000019c0000c13d0000000a010000290000000000100435000000080100002900000007020000290000000000210435000000000100001900000009020000290651007b0000040f000500000001001d0651064f0000040f0000000102000029000000000121016f00000001011001bf00000005020000290651064d0000040f000000090100002900000000010104330000000a020000290000000000210435000001a602000041000001a703000041000000000023041f00000008020000290651000e0000040f000000060200002900000001022000390000013e0000013d000001000100003900000008020000290000000000210439000001200200003900000000000204390000004002000039000001a103000041065100b00000040f000000090100002900000000010104330000004402100039000001a303000041000000000032043500000024021000390000000d030000390000000000320435000001a40200004100000000002104350000000402100039000000080300002900000000003204350000006402000039065100b70000040f00000000010204330000004402100039000001a803000041000000000032043500000024021000390000000d030000390000000000320435000001a4020000410000000000210435000000040210003900000000004204350000006402000039065100b70000040f000000090100002900000000010104330000004402100039000001a5030000410000000000320435000000240210003900000013030000390000000000320435000001a40200004100000000002104350000000402100039000000080300002900000000003204350000006402000039065100b70000040f0007000000000002000000000c0004110000000008000410000080020180008c000001be0000613d0000800101c0008c000001be0000613d000001aa01000041000000000010043900000004010000390000000000810439000080020100003900050000000c001d000400000008001d065100a60000040f0000000408000029000000050c000029000000000110004c000002200000613d000700400000003d0000008001000039000000400b00003900000000001b04350000000005000031000000040150008c0000021e0000413d000600000000001d0000000203000367000000000103043b000000e006100270000001ab0160009c000000040150008a0000000402300370000002730000613d000001ac0460009c000002c10000613d000001ad0460009c000003010000613d000001ae0460009c0000031d0000613d000001af0460009c0000002404300370000002270000613d000001b00560009c000003440000613d000001b10560009c0000035b0000613d000001b20360009c000002240000c13d0000000003000416000000000330004c00000000070000190000037a0000c13d0000019e03000041000000400510008c000000000500001900000000050340190000019e01100197000000000610004c000000000300a0190000019e0110009c00000000010500190000000001036019000000000110004c00000000070000190000037a0000c13d000000000202043b000001a20120009c000003580000213d000000000104043b000001a203100197000001a20110009c00000000070000190000037a0000213d000400000008001d000100000002001d00030000000b001d000000000100001900050000000c001d000200000003001d0651064f0000040f000001a2011001970000000502000029000000000112004b000000000100001900000001010060390651059e0000040f0000000208000029000000000180004c000003f90000c13d000001b60100004100000000001004390000000401000039000000040200002900000000002104390000800a01000039065100a60000040f0000000103000039000500000001001d00000000010004140000000105000029000000040250008c000004b30000613d000000030200002900000000030204330000000504000029000000000240004c000004a40000c13d00000000020500190000000004000019000000000500001900000000060000190651001d0000040f0000000003010019000004b30000013d000000000150004c000002240000c13d000000000100001900000000020000190000000003000019065100b00000040f00000000010000190000000002000019065100b70000040f0000019e06000041000000c00710008c000000000700001900000000070640190000019e08100197000000000980004c000000000600a0190000019e0880009c000000000607c019000000000660004c00000000070000190000037a0000c13d000000000202043b0000019c0620009c00000000070000190000037a0000213d00000023062000390000019e07000041000000000856004b000000000800001900000000080780190000019e095001970000019e06600197000000000a96004b0000000007008019000000000696013f0000019e0660009c00000000060800190000000006076019000000000660004c00000000070000190000037a0000c13d0000000406200039000000000663034f000000000606043b0000019c0760009c00000000070000190000037a0000213d00000000026200190000002402200039000000000252004b00000000070000190000037a0000213d000000000204043b0000019c0420009c00000000070000190000037a0000213d00000000012100490000019e02000041000002600410008c000000000400001900000000040240190000019e01100197000000000510004c000000000200a0190000019e0110009c00000000010400190000000001026019000000000110004c00000000070000190000037a0000c13d0000008401300370000000000101043b000000010110008c00000000070000190000037a0000213d0000800101c0008c0000000001000019000000010100603900030000000b001d065105b00000040f0000000301000029000000000101043300000000020000190000000003000019065100b00000040f0000000003000416000000000330004c00000000070000190000037a0000c13d0000019e030000410000001f0410008c000000000400001900000000040320190000019e01100197000000000510004c00000000030080190000019e0110009c00000000010400190000000001036019000000000110004c00000000070000190000037a0000613d000000000102043b000400000001001d000001c40110009c000003580000813d000000000100001900050000000c001d0651064f0000040f000001a2011001970000000502000029000000000112004b000000000100001900000001010060390651059e0000040f0000000401000029000000000110004c0000000001000019000000010100c0390651062c0000040f0000000401000029000000000010043500000001020000390000002001000039000300000001001d000200000002001d000000000021043500000040020000390000000001000019000500000002001d0651007b0000040f0651064f0000040f000000ff011001900000039e0000c13d00000004010000290000000000100435000000030100002900000002020000290000000000210435000000000100001900000005020000290651007b0000040f000200000001001d0651064f0000040f000001000200008a000000000121016f00000001011001bf00000002020000290651064d0000040f0000000501000029000000000101043300000004020000290000000000210435000001a602000041000001a703000041000000000023041f00000003020000290651000e0000040f0000000501000029000000000101043300000000020000190000000003000019065100b00000040f0000000003000416000000000330004c00000000070000190000037a0000c13d0000019e03000041000000200410008c000000000400001900000000040340190000019e01100197000000000510004c000000000300a0190000019e0110009c00000000010400190000000001036019000000000110004c00000000070000190000037a0000c13d000000000102043b000400000001001d000001a20110009c000003580000213d000000000100001900050000000c001d0651064f0000040f000001a2011001970000000502000029000000000112004b000000000100001900000001010060390651059e0000040f0000000401000029000000000110004c0000000001000019000000010100c0390651062c0000040f0000000401000029000000000010043500000001020000390000002001000039000300000001001d000200000002001d000000000021043500000040020000390000000001000019000500000002001d0651007b0000040f0651064f0000040f000000ff01100190000003ad0000c13d000000050100002900000000010104330000004402100039000001c303000041000000000032043500000024021000390000000f030000390000000000320435000001a40200004100000000002104350000000402100039000000030300002900000000003204350000006402000039065100b70000040f0000000002000416000000000220004c00000000070000190000037a0000c13d0000019e02000041000000000310004c000000000300001900000000030240190000019e01100197000000000410004c000000000200a0190000019e0110009c00000000010300190000000001026019000000000110004c00000000070000190000037a0000c13d000000000100001900030000000b001d0651064f0000040f00000003020000290000000003020433000001a2011001970000000000130435000000200200003900000000010300190000000003000019065100b00000040f0000000002000416000000000220004c00000000070000190000037a0000c13d0000019e02000041000000200310008c000000000300001900000000030240190000019e01100197000000000410004c000000000200a0190000019e0110009c00000000010300190000000001026019000000000110004c00000000070000190000037a0000c13d00030000000b001d065105950000040f000001a201100197000000000010043500000001010000390000002002000039000500000002001d0000000000120435000000000100001900000003020000290651007b0000040f0651064f0000040f00000003020000290000000002020433000000ff011001900000000001000019000000010100c0390000000000120435000000000102001900000005020000290000000003000019065100b00000040f0000000003000416000000000330004c00000000070000190000037a0000c13d0000019e03000041000000200410008c000000000400001900000000040340190000019e01100197000000000510004c000000000300a0190000019e0110009c00000000010400190000000001036019000000000110004c00000000070000190000037a0000c13d000000000202043b000001a20120009c0000037d0000a13d00000000010000190000000002000019065100b70000040f0000019e02000041000000600410008c000000000400001900000000040240190000019e05100197000000000650004c000000000200a0190000019e0550009c000000000204c019000000000220004c00000000070000190000037a0000c13d0000004402300370000000000502043b0000019c0250009c00000000070000190000037a0000213d00000000015100490000019e02000041000002600310008c000000000300001900000000030240190000019e01100197000000000410004c000000000200a0190000019e0110009c00000000010300190000000001026019000000000110004c0000000007000019000003c90000613d00000000010700190000000002070019065100b70000040f00030000000b001d000000000100001900050000000c001d000400000002001d0651064f0000040f000200000001001d000001a2011001970000000502000029000000000112004b00000000010000190000000101006039000500000001001d0651059e0000040f00000005010000290651059e0000040f0000000402000029000000000120004c000003ea0000c13d000000030100002900000000010104330000004402100039000001c1030000410000000000320435000000240210003900000018030000390000000000320435000001a40200004100000000002104350000000402100039000000200300003900000000003204350000006402000039065100b70000040f000000050100002900000000010104330000004402100039000001a5030000410000000000320435000000240210003900000013030000390000000000320435000001a40200004100000000002104350000000402100039000000030300002900000000003204350000006402000039065100b70000040f00000004010000290000000000100435000000030100002900000002020000290000000000210435000000000100001900000005020000290651007b0000040f000200000001001d0651064f0000040f000001000200008a000000000121016f00000002020000290651064d0000040f0000000501000029000000000101043300000004020000290000000000210435000001c202000041000001a703000041000000000023041f00000003020000290651000e0000040f0000000501000029000000000101043300000000020000190000000003000019065100b00000040f00030000000b001d0000000401500039000400000001001d0000800101c0008c00000000010000190000000101006039000500000005001d065105b00000040f000000050100002900000224021000390000000401000029000200000002001d065105c50000040f000000030120008c000004300000213d000000030100002900000000010104330000006402100039000001be0300004100000000003204350000004402100039000001bf03000041000000000032043500000024021000390000003a030000390000000000320435000001a40200004100000000002104350000000402100039000000200300003900000000003204350000008402000039065100b70000040f0000000201000029000001a001100197000000000121019f00000000020000190651064d0000040f00000003010000290000000001010433000001c0020000410000000203000039000000000023041f0000000402000029000000000002041e00000000020000190000000003000019065100b00000040f00000003050000290000000003050433000001b30100004100000000001304350000000401300039000000040200002900000000002104350000000001000414000000040280008c0000045d0000613d000000200500003900000000020800190000000004030019000500000003001d0651004d0000040f000000050300002900000002080000290000000305000029000000000110004c00000000070000190000045d0000c13d00000001040000310000001f0240018f0000000303700367000000070100002900000000010104330000000504400270000000000540004c0000041f0000613d000000000500001900000005065002100000000007610019000000000663034f000000000606043b00000000006704350000000105500039000000000645004b000004170000413d000000000520004c0000042e0000613d0000000504400210000000000343034f00000000044100190000000302200210000000000504043300000000052501cf000000000525022f000000000303043b0000010002200089000000000323022f00000000022301cf000000000252019f00000000002404350000000102000031065100b70000040f00000004010000290000000202000029065105c50000040f000000040220008c0000000007000019000000030300002900000005040000290000037a0000413d0000000202000367000000000112034f000000000101043b000001b801100197000001b90110009c000004960000c13d0000002401400039000000000112034f000000000101043b000001a201100197000000000010043500000001010000390000002002000039000300000002001d000000000012043500000040020000390000000001000019000400000002001d0651007b0000040f0651064f0000040f000000ff01100190000004cc0000c13d000000040100002900000000010104330000004402100039000001bd030000410000000000320435000000240210003900000017030000390000000000320435000001a40200004100000000002104350000000402100039000000030300002900000000003204350000006402000039065100b70000040f0000000101000031000000200210008c00000020010080390000001f02100039000000600420018f0000000002340019000000000442004b000000000600001900000001060040390000019c0420009c000005760000213d0000000104600190000005760000c13d00000000002504350000019e02000041000000200410008c000000000600001900000000060240190000019e01100197000000000410004c000000000200a0190000019e0110009c00000000010600190000000001026019000000000110004c000000000700001900000001020000290000037a0000c13d000000000603043300000007010000290000000009010433000001b4010000410000000000190435000000040190003900000000002104350000002401900039000000000061043500000000010004140000000607000029000000040280008c000005550000613d000500000006001d000000000270004c000400000007001d000200000009001d000005320000c13d000000440400003900000020060000390000000002080019000000000309001900000000050900190651001d0000040f0000000209000029000000040700002900000003050000290000000506000029000005530000013d00000000010304330000004402100039000001ba03000041000000000032043500000024021000390000001a030000390000000000320435000001a40200004100000000002104350000000402100039000000200300003900000000003204350000006402000039065100b70000040f00000040023002100000019802200197000000c0011002100000019701100197000000000121019f0000019b011001c7000080090200003900000000030400190000000004050019065106480000040f00000000030100190000006003300270000101960030019d0003000000010355000000010320018f000400000003001d065105f20000040f0000000402000029000000050600002900000007010000290000000001010433000000000220004c000004c80000c13d0000004402100039000001b7030000410000000000320435000000240210003900000011030000390000000000320435000001a40200004100000000002104350000000402100039000000200300003900000000003204350000006402000039065100b70000040f000000000061043500000020020000390000000003000019065100b00000040f00000004010000290000000301000029000000050400002900000064014000390000000202000367000000000312034f000000a401400039000000000112034f000000000101043b000000000203043b000000000320004c000004e40000613d000000010300008a00000000432300d9000000000331004b000004e40000a13d000001a901000041000000000010043500000011010000390000000402000039000000000012043500000024020000390000000001000019065100b70000040f00000000132100a9000000000100041400000004020000290000000004020433000000000230004c000004f20000c13d000080010200003900000000030400190000000004000019000000000500001900000000060000190651001d0000040f000500000001001d000005010000013d00000040024002100000019802200197000000c0011002100000019701100197000000000121019f0000019b011001c700008009020000390000800104000039065106480000040f00000000030100190000006003300270000101960030019d0003000000010355000000010120018f000500000001001d065105f20000040f000000040100002900000000010104330000000502000029000000000220004c000005170000c13d0000006402100039000001bb0300004100000000003204350000004402100039000001bc03000041000000000032043500000024021000390000002a030000390000000000320435000001a40200004100000000002104350000000402100039000000030300002900000000003204350000008402000039065100b70000040f00000003020000290000000000210435000000200310003900000060020000390000000002020433000000000023043500000007030000290000000604000029000000000524004b000005280000813d0000000005140019000000000535001900000080064000390000000006060433000000000065043500000020044000390000051f0000013d00000000031200190000000703300029000000060400002900000000004304350000001f02200039000000200300008a000000000232016f00000007022000290000000003000019065100b00000040f000000c001100210000001970110019700000040029002100000019802200197000000000112019f000001b5011001c7000080090200003900000000030700190000000004080019065106480000040f0000000209000029000000000301034f000000010120018f000000000200001900000005042002100000000005490019000000000443034f000000000404043b00000000004504350000000104200039000000000224004b0000000002000019000000010200403900000001022001900000000002040019000005400000c13d000300000003035500000000020300190000006002200270000101960020019d000000030500002900000004070000290000000506000029000000000110004c0000040e0000613d0000000101000031000000200210008c00000020010080390000001f02100039000000600320018f0000000002930019000000000332004b000000000300001900000001030040390000019c0420009c000005760000213d0000000103300190000005760000c13d00000000002504350000019e02000041000000200310008c000000000300001900000000030240190000019e01100197000000000410004c000000000200a0190000019e0110009c00000000010300190000000001026019000000000110004c0000037a0000c13d0000000002090433000000000120004c0000000001000019000000010100c039000000000112004b000004b70000613d0000037a0000013d000001a901000041000000000010043500000041010000390000000402000039000000000012043500000024020000390000000001000019065100b70000040f0000001f01100039000000200200008a000000000321016f000000400200003900000000010204330000000003310019000000000413004b000000000400001900000001040040390000019c0530009c0000058d0000213d00000001044001900000058d0000c13d0000000000320435000000000001042d000001a901000041000000000010043500000041010000390000000402000039000000000012043500000024020000390000000001000019065100b70000040f00000004010000390000000201100367000000000101043b000001c40210009c0000059b0000813d000000000001042d00000000010000190000000002000019065100b70000040f000000000110004c000005a10000613d000000000001042d000000400100003900000000010104330000004402100039000001a303000041000000000032043500000024021000390000000d030000390000000000320435000001a40200004100000000002104350000000402100039000000200300003900000000003204350000006402000039065100b70000040f000000000110004c000005b30000613d000000000001042d000000400100003900000000010104330000006402100039000001c50300004100000000003204350000004402100039000001c6030000410000000000320435000000240210003900000024030000390000000000320435000001a40200004100000000002104350000000402100039000000200300003900000000003204350000008402000039065100b70000040f000000000300003100000000041300490000001f0540008a0000000204000367000000000224034f000000000202043b0000019e06000041000000000752004b000000000700001900000000070640190000019e055001970000019e08200197000000000958004b000000000600a019000000000558013f0000019e0550009c00000000050700190000000005066019000000000550004c000005ef0000613d0000000001120019000000000214034f000000000202043b0000019c0420009c000005ef0000213d000000000323004900000020011000390000019e04000041000000000531004b000000000500001900000000050420190000019e033001970000019e06100197000000000736004b0000000004008019000000000336013f0000019e0330009c00000000030500190000000003046019000000000330004c000005ef0000c13d000000000001042d00000000010000190000000002000019065100b70000040f0000000101000031000000000210004c000006230000613d0000003f02100039000000200300008a000000000432016f000000400300003900000000020304330000000004420019000000000524004b000000000500001900000001050040390000019c0640009c000006240000213d0000000105500190000006240000c13d000000000043043500000000001204350000002001200039000000030200036700000001040000310000001f0340018f0000000504400270000000000540004c000006140000613d000000000500001900000005065002100000000007610019000000000662034f000000000606043b00000000006704350000000105500039000000000645004b0000060c0000413d000000000530004c000006230000613d0000000504400210000000000242034f00000000014100190000000303300210000000000401043300000000043401cf000000000434022f000000000202043b0000010003300089000000000232022f00000000023201cf000000000242019f0000000000210435000000000001042d000001a901000041000000000010043500000041010000390000000402000039000000000012043500000024020000390000000001000019065100b70000040f000000000110004c0000062f0000613d000000000001042d000000400100003900000000010104330000004402100039000001a803000041000000000032043500000024021000390000000d030000390000000000320435000001a40200004100000000002104350000000402100039000000200300003900000000003204350000006402000039065100b70000040f00000641002104210000000102000039000000000001042d0000000002000019000000000001042d00000646002104230000000102000039000000000001042d0000000002000019000000000001042d0000064b002104210000000102000039000000000001042d0000000002000019000000000001042d000000000012041b000000000001042d000000000101041a000000000001042d0000065100000432000006520001042e0000065300010430000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff00000000ffffffff0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff000000000000000000000000000000000000000000000000ffffffff00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffff020002000000000000000000000000000000002400000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000ffffffffffffffffffffffff00000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffff4d757374206265206f776e65720000000000000000000000000000000000000008c379a000000000000000000000000000000000000000000000000000000000616c72656164792077686974656c697374656400000000000000000000000000aab7954e9d246b167ef88aeddad35209ca2489d95a8aeb59e288d9b19fae5a5400000000000000000000000000000000000000000000000000000020000000016e756c6c205f61646472657373000000000000000000000000000000000000004e487b71000000000000000000000000000000000000000000000000000000001806aa1896bbf26568e884a7374b41e002500962caba6a15023a8d90e8508b83000000000000000000000000000000000000000000000000000000004a4c560d00000000000000000000000000000000000000000000000000000000565ae273000000000000000000000000000000000000000000000000000000008da5cb5b000000000000000000000000000000000000000000000000000000009b19251a00000000000000000000000000000000000000000000000000000000a159ebd000000000000000000000000000000000000000000000000000000000a6f9dae100000000000000000000000000000000000000000000000000000000f6a5ca2000000000000000000000000000000000000000000000000000000000feaea58670a0823100000000000000000000000000000000000000000000000000000000a9059cbb00000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000004400000000000000000000000070a08231b98ef4ca268c9cc3f6b4590e4bfec28280db06bb5d45e689f2a360be6661696c656420746f207265636f766572000000000000000000000000000000ffffffff000000000000000000000000000000000000000000000000000000008c5a344500000000000000000000000000000000000000000000000000000000556e737570706f72746564207061796d617374657220666c6f77000000000000626f6f746c6f61646572000000000000000000000000000000000000000000004661696c656420746f207472616e736665722066756e647320746f2074686520556e73706f6e736f726564207472616e73616374696f6e00000000000000000074206265206174206c656173742034206279746573206c6f6e67000000000000546865207374616e64617264207061796d617374657220696e707574206d7573a2ea9883a321a3e97b8266c2b078bfeec6d50c711ed71f874a90d500ae2eaf3641646472657373206d757374206e6f74206265206e756c6c000000000000000051085ddf9ebdded84b76e829eb58c4078e4b5bdf97d9a94723f336039da467916e6f742077686974656c69737465640000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000074686f64000000000000000000000000000000000000000000000000000000004f6e6c7920626f6f746c6f616465722063616e2063616c6c2074686973206d65";

type UserWhitelistPaymasterConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: UserWhitelistPaymasterConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class UserWhitelistPaymaster__factory extends ContractFactory {
  constructor(...args: UserWhitelistPaymasterConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }

  override deploy(
    _whitelist: PromiseOrValue<string>[],
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<UserWhitelistPaymaster> {
    return super.deploy(
      _whitelist,
      overrides || {}
    ) as Promise<UserWhitelistPaymaster>;
  }
  override getDeployTransaction(
    _whitelist: PromiseOrValue<string>[],
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): TransactionRequest {
    return super.getDeployTransaction(_whitelist, overrides || {});
  }
  override attach(address: string): UserWhitelistPaymaster {
    return super.attach(address) as UserWhitelistPaymaster;
  }
  override connect(signer: Signer): UserWhitelistPaymaster__factory {
    return super.connect(signer) as UserWhitelistPaymaster__factory;
  }

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): UserWhitelistPaymasterInterface {
    return new utils.Interface(_abi) as UserWhitelistPaymasterInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): UserWhitelistPaymaster {
    return new Contract(
      address,
      _abi,
      signerOrProvider
    ) as UserWhitelistPaymaster;
  }
}
