const problemData = {
  laptop_problem_behavior_master: [
    {
      id: 'MPC001',
      main_problem_category: 'Not Turning On',
      sub_problems: [
        {
          id: 'SP001',
          title: 'Laptop not turning on',
          relational_behaviors: [
            {
              id: 'RB001',
              title: 'No power light, no fan',
              default_level: 'L3',
              pricing: { currency: 'INR', min_price: 1500, max_price: 3500 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP002',
          title: 'Laptop turns on then off',
          relational_behaviors: [
            {
              id: 'RB002',
              title: 'Shuts down in 5–10 sec',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP003',
          title: 'Stuck on logo',
          relational_behaviors: [
            {
              id: 'RB003',
              title: 'Logo repeats again and again',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP004',
          title: 'Restart loop',
          relational_behaviors: [
            {
              id: 'RB004',
              title: 'Keeps restarting',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP005',
          title: 'Works only on charger',
          relational_behaviors: [
            {
              id: 'RB005',
              title: 'Battery removed / dead',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP006',
          title: 'No display but power on',
          relational_behaviors: [
            {
              id: 'RB006',
              title: 'Fan running, black screen',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP007',
          title: 'Dead after repair',
          relational_behaviors: [
            {
              id: 'RB007',
              title: 'Earlier technician repaired',
              default_level: 'L4',
              pricing: { currency: 'INR', min_price: 2500, max_price: 7000 },
              repair: true,
              replacement: false,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC002',
      main_problem_category: 'Screen Problem',
      sub_problems: [
        {
          id: 'SP008',
          title: 'Screen broken',
          relational_behaviors: [
            {
              id: 'RB008',
              title: 'Physical crack visible',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP009',
          title: 'Screen flickering',
          relational_behaviors: [
            {
              id: 'RB009',
              title: 'Flickers when lid moves',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP010',
          title: 'Black screen',
          relational_behaviors: [
            {
              id: 'RB010',
              title: 'External display works',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP011',
          title: 'Lines on screen',
          relational_behaviors: [
            {
              id: 'RB011',
              title: 'Vertical/horizontal lines',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP012',
          title: 'Dim display',
          relational_behaviors: [
            {
              id: 'RB012',
              title: 'Brightness very low',
              default_level: 'L3',
              pricing: { currency: 'INR', min_price: 1500, max_price: 3500 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP013',
          title: 'Touch not working',
          relational_behaviors: [
            {
              id: 'RB013',
              title: 'Touch stops responding',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP014',
          title: 'Half display visible',
          relational_behaviors: [
            {
              id: 'RB014',
              title: 'One side black',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: false,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC003',
      main_problem_category: 'Battery Problem',
      sub_problems: [
        {
          id: 'SP015',
          title: 'Battery drains fast',
          relational_behaviors: [
            {
              id: 'RB015',
              title: 'Less than 1 hour backup',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP016',
          title: 'Battery not charging',
          relational_behaviors: [
            {
              id: 'RB016',
              title: 'Charging stuck at 0%',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP017',
          title: 'Battery not detected',
          relational_behaviors: [
            {
              id: 'RB017',
              title: 'Shows no battery',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP018',
          title: 'Battery swollen',
          relational_behaviors: [
            {
              id: 'RB018',
              title: 'Bulging battery',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP019',
          title: 'Laptop shuts at 30%',
          relational_behaviors: [
            {
              id: 'RB019',
              title: 'Sudden shutdown',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: false,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC004',
      main_problem_category: 'Charging Problem',
      sub_problems: [
        {
          id: 'SP020',
          title: 'Laptop not charging',
          relational_behaviors: [
            {
              id: 'RB020',
              title: 'No charging light',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP021',
          title: 'Charging pin loose',
          relational_behaviors: [
            {
              id: 'RB021',
              title: 'Charges only at angle',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP022',
          title: 'Slow charging',
          relational_behaviors: [
            {
              id: 'RB022',
              title: 'Takes very long',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP023',
          title: 'Burn smell near port',
          relational_behaviors: [
            {
              id: 'RB023',
              title: 'Smell or heat',
              default_level: 'L4',
              pricing: { currency: 'INR', min_price: 2500, max_price: 7000 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC005',
      main_problem_category: 'Heating Problem',
      sub_problems: [
        {
          id: 'SP024',
          title: 'Laptop overheating',
          relational_behaviors: [
            {
              id: 'RB024',
              title: 'Body very hot',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP025',
          title: 'Auto shutdown on heat',
          relational_behaviors: [
            {
              id: 'RB025',
              title: 'Turns off on use',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP026',
          title: 'Heating while charging',
          relational_behaviors: [
            {
              id: 'RB026',
              title: 'Only while plugged',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP027',
          title: 'Burn marks inside',
          relational_behaviors: [
            {
              id: 'RB027',
              title: 'Thermal damage',
              default_level: 'L3',
              pricing: { currency: 'INR', min_price: 1500, max_price: 3500 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC006',
      main_problem_category: 'Fan Problem',
      sub_problems: [
        {
          id: 'SP028',
          title: 'Fan noise loud',
          relational_behaviors: [
            {
              id: 'RB028',
              title: 'Jet-like sound',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP029',
          title: 'Fan rattling',
          relational_behaviors: [
            {
              id: 'RB029',
              title: 'Vibration sound',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP030',
          title: 'Fan not spinning',
          relational_behaviors: [
            {
              id: 'RB030',
              title: 'No air output',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC007',
      main_problem_category: 'Slow Performance',
      sub_problems: [
        {
          id: 'SP031',
          title: 'Laptop very slow',
          relational_behaviors: [
            {
              id: 'RB031',
              title: 'General slowness',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP032',
          title: 'Takes long to boot',
          relational_behaviors: [
            {
              id: 'RB032',
              title: 'More than 5 minutes',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP033',
          title: 'Hangs frequently',
          relational_behaviors: [
            {
              id: 'RB033',
              title: 'Freezes randomly',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP034',
          title: 'Slow after update',
          relational_behaviors: [
            {
              id: 'RB034',
              title: 'Issue after update',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP035',
          title: 'Slow + overheating',
          relational_behaviors: [
            {
              id: 'RB035',
              title: 'Gets hot when slow',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC008',
      main_problem_category: 'Software Issue',
      sub_problems: [
        {
          id: 'SP036',
          title: 'Windows not opening',
          relational_behaviors: [
            {
              id: 'RB036',
              title: 'Stuck on loading',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP037',
          title: 'Blue screen error',
          relational_behaviors: [
            {
              id: 'RB037',
              title: 'BSOD appears',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP038',
          title: 'Update stuck',
          relational_behaviors: [
            {
              id: 'RB038',
              title: 'Update loop',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP039',
          title: 'Windows corrupted',
          relational_behaviors: [
            {
              id: 'RB039',
              title: 'Needs reinstall',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC009',
      main_problem_category: 'Virus Issue',
      sub_problems: [
        {
          id: 'SP040',
          title: 'Virus popup',
          relational_behaviors: [
            {
              id: 'RB040',
              title: 'Ads opening',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP041',
          title: 'Browser redirect',
          relational_behaviors: [
            {
              id: 'RB041',
              title: 'Opens unknown sites',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP042',
          title: 'Files missing',
          relational_behaviors: [
            {
              id: 'RB042',
              title: 'Auto delete',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: false,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC010',
      main_problem_category: 'Keyboard Problem',
      sub_problems: [
        {
          id: 'SP043',
          title: 'Keyboard not working',
          relational_behaviors: [
            {
              id: 'RB043',
              title: 'No typing',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP044',
          title: 'Some keys not working',
          relational_behaviors: [
            {
              id: 'RB044',
              title: 'Partial keys dead',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP045',
          title: 'Keyboard got wet',
          relational_behaviors: [
            {
              id: 'RB045',
              title: 'Liquid spill',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC011',
      main_problem_category: 'Touchpad Problem',
      sub_problems: [
        {
          id: 'SP046',
          title: 'Touchpad not working',
          relational_behaviors: [
            {
              id: 'RB046',
              title: 'Cursor not moving',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP047',
          title: 'Touchpad click issue',
          relational_behaviors: [
            {
              id: 'RB047',
              title: 'Click not working',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP048',
          title: 'Touchpad erratic',
          relational_behaviors: [
            {
              id: 'RB048',
              title: 'Moves automatically',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: false,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC012',
      main_problem_category: 'WiFi Issue',
      sub_problems: [
        {
          id: 'SP049',
          title: 'WiFi not connecting',
          relational_behaviors: [
            {
              id: 'RB049',
              title: 'Shows networks but fails',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP050',
          title: 'WiFi not showing',
          relational_behaviors: [
            {
              id: 'RB050',
              title: 'No WiFi option',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP051',
          title: 'WiFi disconnects',
          relational_behaviors: [
            {
              id: 'RB051',
              title: 'Drops frequently',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC013',
      main_problem_category: 'Bluetooth Issue',
      sub_problems: [
        {
          id: 'SP052',
          title: 'Bluetooth not working',
          relational_behaviors: [
            {
              id: 'RB052',
              title: 'Cannot pair devices',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP053',
          title: 'Bluetooth missing',
          relational_behaviors: [
            {
              id: 'RB053',
              title: 'Option not visible',
              default_level: 'L3',
              pricing: { currency: 'INR', min_price: 1500, max_price: 3500 },
              repair: true,
              replacement: false,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC014',
      main_problem_category: 'Sound Issue',
      sub_problems: [
        {
          id: 'SP054',
          title: 'No sound',
          relational_behaviors: [
            {
              id: 'RB054',
              title: 'Speaker silent',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP055',
          title: 'Low sound',
          relational_behaviors: [
            {
              id: 'RB055',
              title: 'Very low volume',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP056',
          title: 'Headphone jack issue',
          relational_behaviors: [
            {
              id: 'RB056',
              title: 'No sound on jack',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC015',
      main_problem_category: 'Camera Issue',
      sub_problems: [
        {
          id: 'SP057',
          title: 'Camera not working',
          relational_behaviors: [
            {
              id: 'RB057',
              title: 'Black screen in apps',
              default_level: 'L1',
              pricing: { currency: 'INR', min_price: 499, max_price: 999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP058',
          title: 'Camera not detected',
          relational_behaviors: [
            {
              id: 'RB058',
              title: 'Missing device',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC016',
      main_problem_category: 'Storage Issue',
      sub_problems: [
        {
          id: 'SP059',
          title: 'Hard disk not detected',
          relational_behaviors: [
            {
              id: 'RB059',
              title: 'No disk in system',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP060',
          title: 'Laptop stuck due to disk',
          relational_behaviors: [
            {
              id: 'RB060',
              title: 'Disk error at boot',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP061',
          title: 'Data deleted',
          relational_behaviors: [
            {
              id: 'RB061',
              title: 'Need recovery',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: false,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC017',
      main_problem_category: 'Physical Damage',
      sub_problems: [
        {
          id: 'SP062',
          title: 'Laptop fell down',
          relational_behaviors: [
            {
              id: 'RB062',
              title: 'Physical impact',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP063',
          title: 'Hinge broken',
          relational_behaviors: [
            {
              id: 'RB063',
              title: 'Screen loose',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: false,
              replacement: true,
            },
          ],
        },
        {
          id: 'SP064',
          title: 'Port broken',
          relational_behaviors: [
            {
              id: 'RB064',
              title: 'USB/HDMI damaged',
              default_level: 'L2',
              pricing: { currency: 'INR', min_price: 900, max_price: 1999 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
    {
      id: 'MPC018',
      main_problem_category: 'Liquid Damage',
      sub_problems: [
        {
          id: 'SP065',
          title: 'Water spill',
          relational_behaviors: [
            {
              id: 'RB065',
              title: 'Spill but works',
              default_level: 'L3',
              pricing: { currency: 'INR', min_price: 1500, max_price: 3500 },
              repair: true,
              replacement: false,
            },
          ],
        },
        {
          id: 'SP066',
          title: 'Not working after spill',
          relational_behaviors: [
            {
              id: 'RB066',
              title: 'Dead after liquid',
              default_level: 'L4',
              pricing: { currency: 'INR', min_price: 2500, max_price: 7000 },
              repair: true,
              replacement: true,
            },
          ],
        },
      ],
    },
  ],
};

export default problemData;
