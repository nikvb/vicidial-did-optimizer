# NON-AGENT API for VICIDial

This document outlines the VICIDial Non-Agent API, which provides a set of functions for interacting with the VICIDial system without using the agent interface.

---

VICIDial NON-AGENT API functions
version: 2.14-6
build: 150820-1451
(c) Copyright 2015  Matt Florell,Joe Johnson, Demian Brecht - Please see the LICENSE file for details
LICENSE: AGPLv2 - http://www.gnu.org/licenses/agpl-2.0.html

This document is meant to be a reference for all of the API functions that are available in the VICIDial agent screen.
This is not a tutorial on how to use the functions, it is just a reference of the variables.

If you are looking for the AGENT API documentation, please see the AGENT_API.txt document.

All variables and functions are not case-sensitive.

The non-agent API is contained in the non_agent_api.php file in your web document root directory for your VICIDial server.
The URL to call for these functions is:
http://server/vicidial/non_agent_api.php

The required variables for all functions are:
- user - a valid VICIDial user with api access enabled
- pass - the password for that user
- function - the function you want to run
- source - any value, but 'test' is a good value to use

The output of all functions is in one of two formats:
- text - This is the default, and is a pipe-delimited text format
- xml - This is available by adding "&format=xml" to your URL string

The output of all functions will have a summary line at the beginning:
- SUCCESS: ... - for a successful execution of the function
- ERROR: ... - for a failed execution of the function

The data in the output will be in the following format:
- field_name => field_value
- ...

The following is a list of all of the functions available in the non-agent API:

- version - returns the version of the API, the build of the API, and the current server time
- blind_monitor - allows you to blind monitor a call
- add_lead - adds a lead to the vicidial_list table
- update_lead - updates a lead in the vicidial_list table
- add_user - adds a user to the vicidial_users table
- update_user - updates a user in the vicidial_users table
- add_phone - adds a phone to the phones table
- update_phone - updates a phone in the phones table
- add_phone_alias - adds a phone alias to the phone_alias table
- update_phone_alias - updates a phone alias in the phone_alias table
- add_list - adds a list to the vicidial_lists table
- update_list - updates a list in the vicidial_lists table
- list_info - returns information about a list
- add_group_alias - adds a group alias to the vicidial_inbound_group_alias table
- did_log_export - exports the did log for a given day
- agent_stats_export - exports the agent stats for a given day
- recording_lookup - looks up a recording for a given lead
- user_group_status - returns the status of a user group
- in_group_status - returns the status of an in-group

The following is a detailed description of each function:

---
function: version
description: returns the version of the API, the build of the API, and the current server time
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=version&source=test
output:
SUCCESS: 2.14-6|150820-1451|2015-08-20 14:51:00
---
function: blind_monitor
description: allows you to blind monitor a call
required variables:
- session_id - the session id of the call to monitor
- server_ip - the server ip of the call to monitor
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=blind_monitor&session_id=8600051&server_ip=10.10.10.15&source=test
output:
SUCCESS: blind monitor initiated for session 8600051 on server 10.10.10.15
---
function: add_lead
description: adds a lead to the vicidial_list table
required variables:
- phone_number - the phone number of the lead
- list_id - the list id to add the lead to
optional variables:
- dnc_check - if set to 'Y', will check the do not call list for the phone number
- campaign_id - if set, will add the lead to the campaign's list if the list_id is not in the campaign's lists
- add_to_hopper - if set to 'Y', will add the lead to the hopper for the campaign
- ... - any other field in the vicidial_list table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=add_lead&phone_number=5555555555&list_id=999&source=test
output:
SUCCESS: lead added with lead_id 12345
---
function: update_lead
description: updates a lead in the vicidial_list table
required variables:
- lead_id - the lead_id of the lead to update
optional variables:
- ... - any other field in the vicidial_list table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=update_lead&lead_id=12345&first_name=test&source=test
output:
SUCCESS: lead 12345 updated
---
function: add_user
description: adds a user to the vicidial_users table
required variables:
- user - the user to add
- pass - the password for the user
- full_name - the full name of the user
- user_level - the user level of the user
- user_group - the user group of the user
optional variables:
- ... - any other field in the vicidial_users table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=add_user&new_user=7777&new_pass=1234&full_name=test%20user&user_level=1&user_group=AGENTS&source=test
output:
SUCCESS: user 7777 added
---
function: update_user
description: updates a user in the vicidial_users table
required variables:
- user_to_update - the user to update
optional variables:
- ... - any other field in the vicidial_users table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=update_user&user_to_update=7777&full_name=test%20user%20updated&source=test
output:
SUCCESS: user 7777 updated
---
function: add_phone
description: adds a phone to the phones table
required variables:
- extension - the extension of the phone
- dialplan_number - the dialplan number of the phone
- server_ip - the server ip of the phone
- protocol - the protocol of the phone
- registration_password - the registration password of the phone
- login - the login of the phone
- pass - the password of the phone
optional variables:
- ... - any other field in the phones table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=add_phone&extension=8000&dialplan_number=8000&server_ip=10.10.10.15&protocol=SIP&registration_password=test&login=8000&pass=test&source=test
output:
SUCCESS: phone 8000 added
---
function: update_phone
description: updates a phone in the phones table
required variables:
- extension_to_update - the extension of the phone to update
optional variables:
- ... - any other field in the phones table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=update_phone&extension_to_update=8000&dialplan_number=8001&source=test
output:
SUCCESS: phone 8000 updated
---
function: add_phone_alias
description: adds a phone alias to the phone_alias table
required variables:
- alias_id - the alias id of the phone alias
- alias_name - the alias name of the phone alias
- log_in - the login of the phone alias
- log_pass - the password of the phone alias
optional variables:
- ... - any other field in the phone_alias table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=add_phone_alias&alias_id=testalias&alias_name=test%20alias&log_in=8000&log_pass=test&source=test
output:
SUCCESS: phone alias testalias added
---
function: update_phone_alias
description: updates a phone alias in the phone_alias table
required variables:
- alias_id_to_update - the alias id of the phone alias to update
optional variables:
- ... - any other field in the phone_alias table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=update_phone_alias&alias_id_to_update=testalias&alias_name=test%20alias%20updated&source=test
output:
SUCCESS: phone alias testalias updated
---
function: add_list
description: adds a list to the vicidial_lists table
required variables:
- list_id - the list id to add
- list_name - the list name to add
- campaign_id - the campaign id to add the list to
optional variables:
- ... - any other field in the vicidial_lists table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=add_list&list_id=1000&list_name=test%20list&campaign_id=TESTCAMP&source=test
output:
SUCCESS: list 1000 added
---
function: update_list
description: updates a list in the vicidial_lists table
required variables:
- list_id_to_update - the list id to update
optional variables:
- ... - any other field in the vicidial_lists table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=update_list&list_id_to_update=1000&list_name=test%20list%20updated&source=test
output:
SUCCESS: list 1000 updated
---
function: list_info
description: returns information about a list
required variables:
- list_id - the list id to get information about
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=list_info&list_id=1000&source=test
output:
SUCCESS: list 1000 information
list_id => 1000
list_name => test list updated
campaign_id => TESTCAMP
active => N
...
---
function: add_group_alias
description: adds a group alias to the vicidial_inbound_group_alias table
required variables:
- group_alias_id - the group alias id to add
- group_alias_name - the group alias name to add
- caller_id_number - the caller id number to use for the group alias
optional variables:
- ... - any other field in the vicidial_inbound_group_alias table can be added as a variable
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=add_group_alias&group_alias_id=testalias&group_alias_name=test%20alias&caller_id_number=3125551212&source=test
output:
SUCCESS: group alias testalias added
---
function: did_log_export
description: exports the did log for a given day
required variables:
- query_date - the date to export the did log for (YYYY-MM-DD)
optional variables:
- did_id - the did id to export the log for
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=did_log_export&query_date=2015-08-20&source=test
output:
SUCCESS: did log for 2015-08-20
... (pipe-delimited data)
---
function: agent_stats_export
description: exports the agent stats for a given day
required variables:
- query_date - the date to export the agent stats for (YYYY-MM-DD)
optional variables:
- user - the user to export the stats for
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=agent_stats_export&query_date=2015-08-20&source=test
output:
SUCCESS: agent stats for 2015-08-20
... (pipe-delimited data)
---
function: recording_lookup
description: looks up a recording for a given lead
required variables:
- lead_id - the lead_id to look up the recording for
optional variables:
- uniqueid - the uniqueid of the call to look up the recording for
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=recording_lookup&lead_id=12345&source=test
output:
SUCCESS: recording lookup for lead 12345
location => http://server/recordings/20150820-145100_5555555555_12345.mp3
...
---
function: user_group_status
description: returns the status of a user group
required variables:
- user_group - the user group to get the status of
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=user_group_status&user_group=AGENTS&source=test
output:
SUCCESS: user group AGENTS status
agents_logged_in => 1
agents_in_calls => 0
agents_waiting => 1
...
---
function: in_group_status
description: returns the status of an in-group
required variables:
- in_group - the in-group to get the status of
example: http://server/vicidial/non_agent_api.php?user=6666&pass=1234&function=in_group_status&in_group=AGENTDIRECT&source=test
output:
SUCCESS: in-group AGENTDIRECT status
calls_waiting => 0
agents_logged_in => 1
...
---
